#!/usr/bin/env groovy
//
// Mojarra release pipeline — replaces the legacy 3-job chain
// (1_mojarra-build-and-stage / 2_mojarra-run-tck / 3_mojarra-staging-to-release).
//
// Stages:
//   Prepare
//   -> Build & install (single reactor — impl + faces/api submodule via -Papi)
//   -> TCK
//   -> Deploy to Maven Central (skipped on DRY_RUN)
//   -> Bump to next snapshot
//   -> Publish to GitHub (skipped on DRY_RUN)
//
// Maven Central deploy and GitHub push BOTH run only after the TCK passes,
// so a TCK failure leaves no half-published external state.
//
// On 5.0+ the standalone jakarta.faces-api lives in jakartaee/faces and is wired into mojarra
// as a git submodule at faces/. The mojarra-parent pom adds it to the reactor via the `api`
// profile. Activating `-Papi` makes one `mvn install`/`deploy` build & publish both artifacts
// in a single reactor invocation. `versions:set` is run twice though — once on the mojarra
// reactor (cascades to impl) and once on faces/api/pom.xml directly, because faces/api has a
// different parent (org.eclipse.ee4j:project) and so doesn't inherit mojarra's version bump.
//
// Whether to release the API alongside the impl is auto-inferred from impl/pom.xml's
// jakarta.faces-api dependency version: a -SNAPSHOT means the API is unreleased and must be
// released, while a GA version means the API is already on Maven Central and only the impl
// is rebuilt (impl-only patch release).
//
// Maven Central publication is gated by -Dcentral.autoPublish=true (set only by this Jenkinsfile).
// A bare `mvn deploy -Pcentral-release` from a developer machine stages the bundle in the Portal
// but does NOT publish — only CI flips the flag.
//

// JDK install root layout on Eclipse CI: /opt/tools/java/<prefix>/jdk-<N>/latest. Prefix is a
// function of major version, not branch — kept here as a shared lookup so both the build JDK
// (jdk) and the TCK JDK (tckJdk) can resolve their install path the same way.
def JAVA_PREFIX_BY_JDK = [
    '11': 'openjdk',
    '17': 'openjdk',
    '21': 'temurin',
]

// ---- Per-branch configuration ---------------------------------------------
// Adding a new release line = one entry here.
//
// Branch mapping mojarra <-> jakartaee/faces (TCK + API sources):
//   mojarra 4.0    -> faces repo branch 4.0.x   (TCK source; API was bundled with impl)
//   mojarra 4.1    -> faces repo branch master  (TCK source; API was bundled with impl)
//   mojarra master -> faces repo branch 5.0     (both API artifact AND TCK source — wired in via the
//                                                faces submodule; matches .gitmodules `branch = 5.0`)
//
// Fields:
//   versionFamily  : the MAJOR.MINOR family this branch represents (does NOT always equal BRANCH: mojarra
//                    "master" maps to "5.0"). Used both as the path segment on
//                    download.eclipse.org/jakartaee/faces/<here>/ AND as the required prefix for
//                    RELEASE_VERSION (sanity check: must start with versionFamily + ".").
//   jdk            : major JDK version used to build & install the impl (per Faces spec).
//   tckJdk         : major JDK version used to run the TCK. Differs from jdk when the GlassFish
//                    container needs a newer JDK than the spec.
//   apiBranch      : faces-repo branch for the standalone jakarta.faces-api jar (null pre-5.0).
//                    Must match .gitmodules on that branch of mojarra.
//   facesVersion   : -Dfaces.version passed to the TCK build
//   tckVersion     : Faces TCK release version
//   gfVersion      : GlassFish Maven coordinate version used by the TCK
//   chromeVersion  : Chrome-for-Testing build to install on the Eclipse CI agent (which has no
//                    pre-installed browser) so that the TCK's Selenium-driven tests (anything
//                    extending BaseITNG, gated on -Dtest.selenium=true → pom default) can run.
//                    Must be CDP-compatible with the Selenium import baked into the TCK util's
//                    ChromeDevtoolsDriver for that branch:
//                       4.0.x  → tck util imports devtools.v108  → ideally Chrome ~108
//                       master → tck util imports devtools.v139  → Chrome 139
//                       5.0    → tck util imports devtools.v139  → Chrome 139
//                    Set to null/empty to skip the Chrome bootstrap and force HtmlUnit-only via
//                    -Dtest.selenium=false. This is the right choice for 4.0 because Chrome 108
//                    predates Chrome-for-Testing (CfT starts at Chrome ~115), so we cannot
//                    install a CDP-matching browser anyway, and Selenium 4.7.2's CDP fudge
//                    factor across 7+ majors is not reliable. 4.0.3 was originally certified
//                    HtmlUnit-only; preserving that.
//                    Available URLs: https://googlechromelabs.github.io/chrome-for-testing/
def BRANCH_CONFIG = [
    '4.0'   : [ versionFamily: '4.0', jdk: '11', tckJdk: '11', apiBranch: null,  facesVersion: '4.0.1', tckVersion: '4.0.3', gfVersion: '7.0.25'  , chromeVersion: null               ],
    '4.1'   : [ versionFamily: '4.1', jdk: '17', tckJdk: '21', apiBranch: null,  facesVersion: '4.1.0', tckVersion: '4.1.0', gfVersion: '8.0.0-M6', chromeVersion: '139.0.7258.155'   ],
    'master': [ versionFamily: '5.0', jdk: '17', tckJdk: '21', apiBranch: '5.0', facesVersion: '5.0.0', tckVersion: '5.0.0', gfVersion: '9.0.0-M2', chromeVersion: '139.0.7258.155'   ],
]

// Reusable shell snippet: GPG keyring import + trust. Idempotent on the same agent;
// required at the top of every stage that signs (Build install signs javadoc/sources via the
// release profile chain; Deploy signs everything for Maven Central) because `agent any` may
// land different stages on different agents whose ~/.gnupg is empty.
// Inside ''' Groovy strings, ${...} stays literal so bash sees ${KEYRING}.
def GPG_INIT = '''
    gpg --batch --import "${KEYRING}"
    for fpr in $(gpg --list-keys --with-colons | awk -F: '/fpr:/ {print $10}' | sort -u); do
        echo -e "5\\ny\\n" | gpg --batch --command-fd 0 --expert --edit-key "${fpr}" trust
    done
'''

// Reusable shell snippet: bot git identity. Sets local (per-repo) config, so must run inside the
// working tree of the repo about to be committed to.
def GIT_IDENTITY = '''
    git config user.email "mojarra-bot@eclipse.org"
    git config user.name  "Eclipse Mojarra Bot"
'''

def GPG_GIT_INIT = GPG_INIT + GIT_IDENTITY

// Reusable shell snippet: enforce branch/tag does not exist on origin (or delete it under OVERWRITE).
// Expects bash variables BRANCH_NAME and TAG_NAME to be set in the surrounding script.
def REMOTE_REF_CONFLICT_CHECK = '''
    if [ "${DRY_RUN}" != "true" ]; then
        if git ls-remote --heads origin | grep -q "refs/heads/${BRANCH_NAME}$"; then
            if [ "${OVERWRITE}" = "true" ]; then
                git push --delete origin "${BRANCH_NAME}" || true
            else
                echo "Release branch ${BRANCH_NAME} exists on origin; set OVERWRITE=true to replace." >&2; exit 1
            fi
        fi
        if git ls-remote --tags origin | grep -q "refs/tags/${TAG_NAME}$"; then
            if [ "${OVERWRITE}" = "true" ]; then
                git push --delete origin "${TAG_NAME}" || true
            else
                echo "Release tag ${TAG_NAME} exists on origin; set OVERWRITE=true to replace." >&2; exit 1
            fi
        fi
    fi
    git branch -D "${BRANCH_NAME}" 2>/dev/null || true
    git tag    -d "${TAG_NAME}"    2>/dev/null || true
    git checkout -b "${BRANCH_NAME}"
'''

pipeline {
    agent any

    parameters {
        choice(name: 'BRANCH',          choices: ['4.0', '4.1', 'master'],
               description: 'Branch to release. master is currently 5.0.')
        string(name: 'RELEASE_VERSION', defaultValue: '',
               description: 'Leave blank to auto-infer from parent pom.xml (strips -SNAPSHOT). Must be a dotted-numeric GA version (e.g. 4.1.5); milestone/RC versions are not supported.')
        choice(name: 'JDK',             choices: ['', '11', '17', '21'],
               description: 'Leave blank to auto-infer from BRANCH (11 for 4.0, 17 for 4.1, 17 for master).')
        choice(name: 'TCK_JDK',         choices: ['', '11', '17', '21'],
               description: 'JDK used to RUN the TCK (the GlassFish container may need a newer JDK than the spec). Leave blank to auto-infer from BRANCH (17 for 4.0, 21 for 4.1 and master).')
        string(name: 'TCK_VERSION',     defaultValue: '',
               description: 'Leave blank to auto-infer from BRANCH.')
        string(name: 'GF_VERSION',      defaultValue: '',
               description: 'Leave blank to auto-infer from BRANCH. When using GF_BUNDLE_URL, set this to match the artifact version inside the zip (e.g. 8.0.0-X).')
        string(name: 'GF_BUNDLE_URL',   defaultValue: '',
               description: 'Optional GlassFish zip URL override. If set, GF_VERSION must also be set to match.')
        string(name: 'CHROME_VERSION',  defaultValue: '',
               description: 'Optional Chrome-for-Testing version override (e.g. 139.0.7258.155). Leave blank to auto-infer from BRANCH. Set to literal "none" to skip the Chrome install and run HtmlUnit-only tests via -Dtest.selenium=false. See https://googlechromelabs.github.io/chrome-for-testing/ for available builds.')
        string(name: 'API_RELEASE_VERSION', defaultValue: '',
               description: '5.0+ only. Leave blank to auto-infer from faces/api/pom.xml. Ignored when impl/pom.xml pins jakarta.faces-api to a GA version (impl-only release).')
        booleanParam(name: 'RUN_TCK',     defaultValue: true,  description: 'Run the Faces TCK after build.')
        booleanParam(name: 'DRY_RUN',     defaultValue: false, description: 'Skip Maven Central deploy and GitHub push (locally installs the artifacts instead). Run TCK against the local install.')
        booleanParam(name: 'OVERWRITE',   defaultValue: false, description: 'Allow overwriting existing release branch/tag in GitHub.')
    }

    options {
        disableConcurrentBuilds()
        buildDiscarder(logRotator(daysToKeepStr: '300', numToKeepStr: '20'))
        timestamps()
    }

    environment {
        TOOLS_PREFIX  = '/opt/tools'
        MVN_HOME      = "${TOOLS_PREFIX}/apache-maven/latest"
        MVN_EXTRA     = '--batch-mode --no-transfer-progress'
        VERSIONS_PLUGIN = 'org.codehaus.mojo:versions-maven-plugin:2.18.0'
        HELP_PLUGIN     = 'org.apache.maven.plugins:maven-help-plugin:3.5.1'
    }

    stages {

        stage('Prepare') {
            steps {
                cleanWs()
                script {
                    def cfg = BRANCH_CONFIG[params.BRANCH]
                    if (cfg == null) error "Unknown BRANCH: ${params.BRANCH}"

                    env.RESOLVED_JDK         = params.JDK?.trim()         ?: cfg.jdk
                    env.RESOLVED_TCK_JDK     = params.TCK_JDK?.trim()     ?: cfg.tckJdk
                    env.RESOLVED_TCK_VERSION = params.TCK_VERSION?.trim() ?: cfg.tckVersion
                    env.RESOLVED_GF_VERSION  = params.GF_VERSION?.trim()  ?: cfg.gfVersion
                    def chromeOverride = params.CHROME_VERSION?.trim()
                    env.RESOLVED_CHROME_VERSION = (chromeOverride == 'none') ? '' :
                                                  (chromeOverride ?: (cfg.chromeVersion ?: ''))
                    env.FACES_VERSION        = cfg.facesVersion
                    env.VERSION_FAMILY       = cfg.versionFamily
                    env.API_BRANCH           = cfg.apiBranch ?: ''
                    if (!JAVA_PREFIX_BY_JDK.containsKey(env.RESOLVED_JDK)) {
                        error "No JDK install prefix configured for JDK ${env.RESOLVED_JDK}. Update JAVA_PREFIX_BY_JDK at the top of Jenkinsfile."
                    }
                    if (!JAVA_PREFIX_BY_JDK.containsKey(env.RESOLVED_TCK_JDK)) {
                        error "No JDK install prefix configured for TCK JDK ${env.RESOLVED_TCK_JDK}. Update JAVA_PREFIX_BY_JDK at the top of Jenkinsfile."
                    }
                    env.JAVA_HOME      = "${env.TOOLS_PREFIX}/java/${JAVA_PREFIX_BY_JDK[env.RESOLVED_JDK]}/jdk-${env.RESOLVED_JDK}/latest"
                    env.TCK_JAVA_HOME  = "${env.TOOLS_PREFIX}/java/${JAVA_PREFIX_BY_JDK[env.RESOLVED_TCK_JDK]}/jdk-${env.RESOLVED_TCK_JDK}/latest"
                    env.PATH           = "${env.MVN_HOME}/bin:${env.JAVA_HOME}/bin:${env.PATH}"

                    sh 'java -version && mvn -v'
                }
                // Mojarra checkout. On master (5.0+) this also initializes the faces/ submodule, tracking
                // the configured branch tip (per .gitmodules) rather than the recorded SHA — release should
                // pull the latest API code, not whatever was pinned at last commit. On 4.0/4.1 there is no
                // .gitmodules so SubmoduleOption is a no-op.
                checkout([$class: 'GitSCM',
                    branches: [[name: "*/${params.BRANCH}"]],
                    userRemoteConfigs: [[url: 'git@github.com:eclipse-ee4j/mojarra.git',
                                         credentialsId: 'github-bot-ssh']],
                    extensions: [
                        [$class: 'SubmoduleOption',
                         disableSubmodules: false,
                         parentCredentials: true,
                         recursiveSubmodules: false,
                         trackingSubmodules: true]
                    ]])
                // .gitmodules uses HTTPS for the faces submodule (contributor-friendly anonymous clone),
                // but CI pushes back via the SSH credential. Override the remote URL inside the submodule
                // so the later `git push origin` from `dir('faces')` uses SSH and authenticates correctly.
                script {
                    if (fileExists('faces/.git') || fileExists('.git/modules/faces')) {
                        dir('faces') {
                            sh 'git remote set-url origin git@github.com:jakartaee/faces.git'
                        }
                    }
                }
                script {
                    def cfg = BRANCH_CONFIG[params.BRANCH]

                    // Resolve RELEASE_VERSION from pom.xml if not supplied.
                    def snapshot = sh(returnStdout: true, script:
                        "mvn -B ${env.HELP_PLUGIN}:evaluate -Dexpression=project.version -q -DforceStdout").trim()
                    if (!(snapshot ==~ /.*-SNAPSHOT$/)) {
                        error "Top-level pom version '${snapshot}' is not a -SNAPSHOT; refusing to release."
                    }
                    env.SNAPSHOT_VERSION = snapshot
                    env.RELEASE_VERSION  = params.RELEASE_VERSION?.trim() ?: snapshot.replace('-SNAPSHOT', '')

                    // Sanity-check release version matches the chosen branch family AND is a dotted-numeric GA version.
                    requireGaVersion('RELEASE_VERSION', env.RELEASE_VERSION, cfg.versionFamily)

                    env.NEXT_VERSION   = bumpLastComponent(env.RELEASE_VERSION) + '-SNAPSHOT'
                    env.RELEASE_TAG    = "${env.RELEASE_VERSION}-RELEASE"
                    env.RELEASE_BRANCH = env.RELEASE_VERSION

                    // Fallback for the CSP backport in Mojarra 4.0.17+ / 4.1.8+ (#5606): a handful of TCK ITs
                    // assume inline event handlers that no longer hold once mojarra.ael attaches them. The
                    // TCK pom's `compute-csp-backport-flags` (in profile glassfish-ci-managed) auto-skips
                    // them based on -Dmojarra.version, but the released TCK zips (4.0.3 / 4.1.0) predate
                    // that script and won't be re-cut. Reproduce the same exclusion here so the impl release
                    // works against the existing TCK zips. If a future TCK ships with the script, our
                    // pre-set `it.test` makes the script's `!containsKey('it.test')` guard a no-op — safe.
                    env.TCK_IT_TEST_FLAGS = cspBackportItTestFlags(env.RELEASE_VERSION)

                    // Auto-infer SHOULD_BUILD_API from impl/pom.xml's jakarta.faces-api dep version.
                    // Rule: if the dep is a -SNAPSHOT, the API is unreleased relative to this impl release
                    // and must be released alongside; if it's a GA version, the API is already on Maven
                    // Central and we do an impl-only release. Pre-5.0 (apiBranch null) the API was bundled
                    // with the impl, so this never applies.
                    if (cfg.apiBranch != null) {
                        def apiDepVersion = readImplApiDepVersion()
                        if (apiDepVersion == '') {
                            error "impl/pom.xml does not declare a jakarta.faces-api dependency. Cannot determine whether to release the API."
                        }
                        if (apiDepVersion.endsWith('-SNAPSHOT')) {
                            env.SHOULD_BUILD_API = 'true'
                        } else if (apiDepVersion ==~ /\d+\.\d+\.\d+(\.\d+)*/) {
                            env.SHOULD_BUILD_API = 'false'
                        } else {
                            error "impl/pom.xml's jakarta.faces-api dep version '${apiDepVersion}' is neither a -SNAPSHOT nor a dotted-numeric GA version (e.g. 5.0.0). Update the dep before releasing."
                        }
                    } else {
                        env.SHOULD_BUILD_API = 'false'
                    }
                    // -Papi if we're building the API in the same reactor; empty otherwise.
                    env.MVN_API_PROFILE = (env.SHOULD_BUILD_API == 'true') ? '-Papi' : ''

                    // Resolve API_RELEASE_VERSION from faces/api/pom.xml if releasing the API.
                    if (env.SHOULD_BUILD_API == 'true') {
                        def apiSnapshot = sh(returnStdout: true, script:
                            "mvn -B -f faces/api/pom.xml ${env.HELP_PLUGIN}:evaluate -Dexpression=project.version -q -DforceStdout").trim()
                        if (!(apiSnapshot ==~ /.*-SNAPSHOT$/)) {
                            error "faces api pom version '${apiSnapshot}' is not a -SNAPSHOT; refusing to release."
                        }
                        env.API_SNAPSHOT_VERSION = apiSnapshot
                        env.RESOLVED_API_VERSION = params.API_RELEASE_VERSION?.trim() ?: apiSnapshot.replace('-SNAPSHOT', '')
                        requireGaVersion('API_RELEASE_VERSION', env.RESOLVED_API_VERSION, null)
                        env.NEXT_API_VERSION   = bumpLastComponent(env.RESOLVED_API_VERSION) + '-SNAPSHOT'
                        env.API_RELEASE_TAG    = "${env.RESOLVED_API_VERSION}-RELEASE"
                        env.API_RELEASE_BRANCH = env.RESOLVED_API_VERSION
                        echo "API snapshot: ${env.API_SNAPSHOT_VERSION} | API release: ${env.RESOLVED_API_VERSION} | Next: ${env.NEXT_API_VERSION}"
                    }

                    def jdkLabel = (env.RESOLVED_JDK == env.RESOLVED_TCK_JDK)
                        ? "JDK${env.RESOLVED_JDK}"
                        : "JDK${env.RESOLVED_JDK}/TCK-JDK${env.RESOLVED_TCK_JDK}"
                    currentBuild.description = "${params.BRANCH} → ${env.RELEASE_VERSION}" +
                        ((env.SHOULD_BUILD_API == 'true') ? " + API ${env.RESOLVED_API_VERSION}" : ' (impl-only)') +
                        " (${jdkLabel}, GF ${env.RESOLVED_GF_VERSION}, TCK ${env.RESOLVED_TCK_VERSION})"
                    echo "Snapshot: ${env.SNAPSHOT_VERSION} | Release: ${env.RELEASE_VERSION} | Next: ${env.NEXT_VERSION}"
                    if (env.SHOULD_BUILD_API == 'true') {
                        echo "Releasing impl AND API in the same reactor (jakarta.faces-api ${env.RESOLVED_API_VERSION})."
                    } else if (cfg.apiBranch != null) {
                        echo "Impl-only release: impl/pom.xml's jakarta.faces-api dep is a GA version, so the API will not be rebuilt."
                    }
                }
            }
        }

        stage('Build & install') {
            steps {
                sshagent(credentials: ['github-bot-ssh']) {
                    withCredentials([file(credentialsId: 'secret-subkeys.asc', variable: 'KEYRING')]) {
                        // Mojarra: GPG init + git identity + branch/tag conflict check + checkout local release branch.
                        sh '#!/bin/bash -ex\nexport BRANCH_NAME="${RELEASE_BRANCH}" TAG_NAME="${RELEASE_TAG}"\n' +
                           GPG_GIT_INIT + REMOTE_REF_CONFLICT_CHECK
                        // Faces (5.0+ only): same ceremony in the submodule working tree.
                        script {
                            if (env.SHOULD_BUILD_API == 'true') {
                                dir('faces') {
                                    sh '#!/bin/bash -ex\nexport BRANCH_NAME="${API_RELEASE_BRANCH}" TAG_NAME="${API_RELEASE_TAG}"\n' +
                                       GIT_IDENTITY + REMOTE_REF_CONFLICT_CHECK
                                }
                            }
                        }
                        // Set release versions. Mojarra parent's versions:set cascades to impl. Faces/api
                        // has a different parent so it needs its own versions:set call. Then pin the impl's
                        // jakarta.faces-api dep to the just-set API version (5.0+ only); -pl impl scopes it.
                        sh '''#!/bin/bash -ex
                            mvn -U -B ${MVN_EXTRA} \\
                                -DnewVersion="${RELEASE_VERSION}" -DgenerateBackupPoms=false \\
                                clean ${VERSIONS_PLUGIN}:set

                            if [ -n "${RESOLVED_API_VERSION:-}" ]; then
                                mvn -U -B ${MVN_EXTRA} -f faces/api/pom.xml \\
                                    -DnewVersion="${RESOLVED_API_VERSION}" -DgenerateBackupPoms=false \\
                                    ${VERSIONS_PLUGIN}:set

                                mvn -U -B ${MVN_EXTRA} -pl impl ${VERSIONS_PLUGIN}:use-dep-version \\
                                    -Dincludes=jakarta.faces:jakarta.faces-api \\
                                    -DdepVersion="${RESOLVED_API_VERSION}" \\
                                    -DforceVersion=true -DgenerateBackupPoms=false
                            fi
                        '''
                        // Faces commit FIRST so the submodule HEAD advances; then the mojarra commit
                        // below picks up the updated `faces` gitlink alongside the pom changes, so the
                        // mojarra release tag references the matching faces release commit.
                        script {
                            if (env.SHOULD_BUILD_API == 'true') {
                                dir('faces') {
                                    sh '''#!/bin/bash -ex
                                        git add -A '*pom.xml'
                                        git commit -m "Prepare release jakarta.faces-api ${RESOLVED_API_VERSION}"
                                    '''
                                }
                            }
                        }
                        sh '''#!/bin/bash -ex
                            git add -A '*pom.xml'
                            # Stage the updated faces submodule gitlink (5.0+ only). No-op on 4.x.
                            if [ -d faces ]; then
                                git add faces
                            fi
                            git commit -m "Prepare release ${RELEASE_VERSION}"
                        '''
                        // Single-reactor build & install. With -Papi (5.0+), faces/api joins the reactor and
                        // -pl impl -am pulls it in as a dependency. Without -Papi (4.0/4.1), only impl builds.
                        sh '''#!/bin/bash -ex
                            mvn -U -B ${MVN_EXTRA} ${MVN_API_PROFILE} \\
                                -DskipTests -Ddoclint=none \\
                                -pl impl -am clean install
                        '''
                        // Tag both repos at their release-prepare commits. Pushes are deferred to "Publish to GitHub".
                        sh '''#!/bin/bash -ex
                            git tag "${RELEASE_TAG}" -m "Release ${RELEASE_VERSION}"
                        '''
                        script {
                            if (env.SHOULD_BUILD_API == 'true') {
                                dir('faces') {
                                    sh '''#!/bin/bash -ex
                                        git tag "${API_RELEASE_TAG}" -m "Release jakarta.faces-api ${RESOLVED_API_VERSION}"
                                    '''
                                }
                            }
                        }
                    }
                }
            }
        }

        stage('TCK') {
            when { expression { return params.RUN_TCK } }
            steps {
                sh '''#!/bin/bash -ex
                    set -o pipefail
                    # The GlassFish container the TCK runs inside may need a different JDK from the
                    # one used to build the impl (e.g. Faces 4.1 builds with 17, GF 8 needs 21).
                    export JAVA_HOME="${TCK_JAVA_HOME}"
                    export PATH="${JAVA_HOME}/bin:${PATH}"

                    # Chrome-for-Testing bootstrap. The Faces TCK drives modern spec tests
                    # (anything extending BaseITNG, gated on -Dtest.selenium=true) through
                    # Selenium + ChromeDriver. Eclipse CI agents do not ship Chrome, so we pull
                    # a pinned Chrome-for-Testing build into the workspace and prepend it to PATH.
                    #
                    # When RESOLVED_CHROME_VERSION is empty, no Chrome is installed and
                    # SELENIUM_FLAG is set to -Dtest.selenium=false so all BaseITNG tests
                    # self-skip (otherwise they would all fail with SessionNotCreatedException
                    # at driver init). 4.0 currently uses this path because Chrome 108 (the CDP
                    # version baked into the 4.0 TCK) predates Chrome-for-Testing.
                    SELENIUM_FLAG=""
                    if [ -n "${RESOLVED_CHROME_VERSION}" ]; then
                        CFT_BASE="https://storage.googleapis.com/chrome-for-testing-public/${RESOLVED_CHROME_VERSION}/linux64"
                        CHROME_DIR="${WORKSPACE}/.chrome-${RESOLVED_CHROME_VERSION}"
                        if [ ! -x "${CHROME_DIR}/chrome-linux64/chrome" ] || [ ! -x "${CHROME_DIR}/chromedriver-linux64/chromedriver" ]; then
                            rm -rf "${CHROME_DIR}" && mkdir -p "${CHROME_DIR}"
                            ( cd "${CHROME_DIR}" && \
                              wget -q "${CFT_BASE}/chrome-linux64.zip" && \
                              wget -q "${CFT_BASE}/chromedriver-linux64.zip" && \
                              unzip -q chrome-linux64.zip && \
                              unzip -q chromedriver-linux64.zip )
                        fi
                        export PATH="${CHROME_DIR}/chrome-linux64:${CHROME_DIR}/chromedriver-linux64:${PATH}"

                        # Eclipse CI agents are minimal Debian-based pods without a browser
                        # toolchain; Chrome dynamically links against NSS / GTK / X libs that
                        # aren't installed by default and we have no root. Fetch the missing
                        # .deb packages with apt-get download (which works as an unprivileged
                        # user) and extract them into the workspace, then prepend the extracted
                        # multiarch lib dir to LD_LIBRARY_PATH so Chrome's loader finds them.
                        # Idempotent: skipped on subsequent runs if the cache already exists.
                        DEPS_DIR="${WORKSPACE}/.chrome-deps"
                        if [ ! -f "${DEPS_DIR}/.installed" ]; then
                            rm -rf "${DEPS_DIR}" && mkdir -p "${DEPS_DIR}/debs"
                            # Some packages were renamed with a 't64' suffix in Ubuntu 24.04
                            # as part of the 64-bit time_t ABI transition (libasound2 ->
                            # libasound2t64, libatk1.0-0 -> libatk1.0-0t64, etc.). Older
                            # distros still use the unsuffixed names. Pick whichever variant
                            # actually has an installable candidate version. Note: probing
                            # via apt-cache show is wrong here — the transitional dummy
                            # package still has metadata but no candidate, so we must use
                            # apt-cache policy and reject Candidate: (none).
                            pick() {
                                for name in "$@"; do
                                    cand=$(apt-cache policy "$name" 2>/dev/null \
                                           | awk "/Candidate:/ {print \\$2}")
                                    if [ -n "$cand" ] && [ "$cand" != "(none)" ]; then
                                        echo "$name"; return 0
                                    fi
                                done
                                echo "ERROR: none of the candidates [$*] have an installable version" >&2
                                return 1
                            }
                            DIRECT="libnspr4 libnss3 libxkbcommon0 libxcomposite1 libxdamage1 \
                                    libxrandr2 libxfixes3 libxshmfence1 libgbm1 \
                                    libpango-1.0-0 libpangocairo-1.0-0 libcairo2 \
                                    libdrm2 libexpat1 libuuid1"
                            DIRECT="${DIRECT} $(pick libasound2t64       libasound2)"
                            DIRECT="${DIRECT} $(pick libatspi2.0-0t64    libatspi2.0-0)"
                            DIRECT="${DIRECT} $(pick libatk1.0-0t64      libatk1.0-0)"
                            DIRECT="${DIRECT} $(pick libatk-bridge2.0-0t64 libatk-bridge2.0-0)"
                            DIRECT="${DIRECT} $(pick libcups2t64         libcups2)"

                            # apt-get download fetches ONLY the listed packages, not their
                            # Depends. Chrome's actual runtime closure (libxcb1, libx11-6,
                            # libfontconfig1, libfreetype6, ...) is reached transitively. Use
                            # apt-cache depends --recurse to expand to the full closure
                            # (~125 packages, ~125 MB on Ubuntu 24.04 noble).
                            CLOSURE=$(apt-cache depends --recurse \
                                --no-recommends --no-suggests --no-conflicts \
                                --no-breaks --no-replaces --no-enhances ${DIRECT} \
                                | grep -v "[<>:]" | grep -v "^$" | sort -u | tr "\\n" " ")

                            # Tolerate per-package 404s from stale mirror state (security.ubuntu
                            # .com sometimes drops a point version mid-day). The chrome --version
                            # sanity check below is the actual gate — if a critical lib is
                            # missing, that fails loud; otherwise an extra missing transitive .deb
                            # is harmless.
                            ( cd "${DEPS_DIR}/debs" && apt-get download ${CLOSURE} || true )
                            for d in "${DEPS_DIR}"/debs/*.deb; do dpkg-deb -x "$d" "${DEPS_DIR}"; done
                            touch "${DEPS_DIR}/.installed"
                        fi
                        export LD_LIBRARY_PATH="${DEPS_DIR}/usr/lib/x86_64-linux-gnu:${DEPS_DIR}/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

                        # Sanity-check both binaries before the TCK starts; a failure here
                        # surfaces any STILL-missing shared lib up front rather than buried in
                        # a SessionNotCreatedException from inside surefire. Use ldd output as
                        # a debug aid when chrome --version itself fails.
                        ldd "${CHROME_DIR}/chrome-linux64/chrome" | grep -E "not found" || true
                        chrome --version
                        chromedriver --version
                    else
                        echo "RESOLVED_CHROME_VERSION is empty -> skipping Chrome install, BaseITNG tests will self-skip via -Dtest.selenium=false."
                        SELENIUM_FLAG="-Dtest.selenium=false"
                    fi

                    rm -rf "faces-tck-${RESOLVED_TCK_VERSION}"
                    mkdir -p download
                    TCK_BUNDLE_NAME="jakarta-faces-tck-${RESOLVED_TCK_VERSION}"
                    TCK_BUNDLE_DIR="faces-tck-${RESOLVED_TCK_VERSION}"
                    TCK_URL="https://download.eclipse.org/jakartaee/faces/${VERSION_FAMILY}/${TCK_BUNDLE_NAME}.zip"

                    wget -q "${TCK_URL}" -O "download/${TCK_BUNDLE_NAME}.zip"
                    unzip -q -o "download/${TCK_BUNDLE_NAME}.zip"

                    if [ -n "${GF_BUNDLE_URL}" ]; then
                        wget -q "${GF_BUNDLE_URL}" -O glassfish.zip
                        mvn ${MVN_EXTRA} install:install-file -Dfile=./glassfish.zip \\
                            -DgroupId=org.glassfish.main.distributions \\
                            -DartifactId=glassfish -Dversion="${RESOLVED_GF_VERSION}" -Dpackaging=zip
                    fi

                    # Failsafe gates on test failures via its own non-zero exit; report rendering and
                    # human-readable summary are deferred to the next stage so a TCK failure fails fast.
                    cd "${TCK_BUNDLE_DIR}/tck"
                    mvn ${MVN_EXTRA} clean install \\
                        -DskipOldTCK=true -Dtck.old.skip=true ${SELENIUM_FLAG} \\
                        -DskipAssembly=true -Pstaging,glassfish-ci-managed \\
                        -pl -:old-faces-tck-parent,-:old-tck-build,-:old-tck-run \\
                        -Dglassfish.version="${RESOLVED_GF_VERSION}" \\
                        -Dmojarra.version="${RELEASE_VERSION}" \\
                        -Dfaces.version="${FACES_VERSION}" \\
                        ${TCK_IT_TEST_FLAGS} \\
                        surefire-report:failsafe-report-only -Daggregate=true \\
                        | tee "${WORKSPACE}/run.log"
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'run.log', allowEmptyArchive: true, fingerprint: true
                }
            }
        }

        stage('TCK report') {
            when { expression { return params.RUN_TCK } }
            steps {
                sh '''#!/bin/bash -ex
                    export JAVA_HOME="${TCK_JAVA_HOME}"
                    export PATH="${JAVA_HOME}/bin:${PATH}"

                    TCK_BUNDLE_NAME="jakarta-faces-tck-${RESOLVED_TCK_VERSION}"
                    TCK_BUNDLE_DIR="faces-tck-${RESOLVED_TCK_VERSION}"
                    TCK_URL="https://download.eclipse.org/jakartaee/faces/${VERSION_FAMILY}/${TCK_BUNDLE_NAME}.zip"

                    cd "${TCK_BUNDLE_DIR}/tck"
                    mvn ${MVN_EXTRA} org.apache.maven.plugins:maven-site-plugin:3.21.0:site \\
                        -DskipOldTCK=true -Dtck.old.skip=true \\
                        -Dmaven.test.skip=true -DskipTests=true \\
                        -DskipAssembly=true -Pstaging \\
                        -pl -:old-faces-tck-parent,-:old-tck-build,-:old-tck-run \\
                        -Dglassfish.version="${RESOLVED_GF_VERSION}" \\
                        -Dmojarra.version="${RELEASE_VERSION}" \\
                        -Dfaces.version="${FACES_VERSION}" \\
                        ${TCK_IT_TEST_FLAGS}

                    cd "${WORKSPACE}"
                    REPORT="${TCK_BUNDLE_DIR}/tck/target/site/failsafe-report.html"
                    awk '/<table/{in_table=1}
                         in_table && /Package/{exit}
                         in_table && /<td/ {sub(/.*<td[^>]*>/,""); sub(/<\\/td>.*/,""); print}' \\
                        "${REPORT}" > tmp_result.txt
                    PASSED=$(sed '1q;d' tmp_result.txt)
                    ERRORS=$(sed '2q;d' tmp_result.txt)
                    FAILED=$(sed '3q;d' tmp_result.txt)

                    {
                        echo "******************************************************"
                        echo "Mojarra ${RELEASE_VERSION} (built with JDK${RESOLVED_JDK}) on GlassFish ${RESOLVED_GF_VERSION} (TCK run with JDK${RESOLVED_TCK_JDK})"
                        if [ -n "${RESOLVED_API_VERSION:-}" ]; then
                            echo "jakarta.faces-api ${RESOLVED_API_VERSION}"
                        fi
                        echo "Faces TCK ${RESOLVED_TCK_VERSION}"
                        echo "Passed: ${PASSED}  Failed: ${FAILED}  Errors: ${ERRORS}"
                        echo "TCK download: ${TCK_URL}"
                        echo "SHA256 TCK : $(sha256sum download/${TCK_BUNDLE_NAME}.zip | awk '{print $1}')"
                        echo "SHA256 IMPL: $(sha256sum ${TCK_BUNDLE_DIR}/tck/target/glassfish*/glassfish/modules/jakarta.faces.jar | awk '{print $1}')"
                        echo "JDK: $(java -version 2>&1 | head -1)"
                        echo "OS : $(lsb_release -ds 2>/dev/null || cat /etc/os-release | head -1)"
                        echo "******************************************************"
                    } > summary.txt

                    # Defense-in-depth: the TCK stage already fails on failsafe errors, but if a future
                    # change reorders or adds -Dmaven.test.failure.ignore=true, this catches it.
                    if [ "${FAILED}" -gt 0 ] || [ "${ERRORS}" -gt 0 ]; then
                        echo "TCK failures detected" >&2
                        exit 1
                    fi
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'summary.txt', allowEmptyArchive: true, fingerprint: true
                }
            }
        }

        stage('Deploy to Maven Central') {
            when { expression { return !params.DRY_RUN } }
            steps {
                withCredentials([file(credentialsId: 'secret-subkeys.asc', variable: 'KEYRING')]) {
                    // Re-import GPG keys: agent may differ from Build & install stage.
                    // -Dcentral.autoPublish=true both activates the central-release profile (via property
                    // activation in impl/pom.xml and faces/api/pom.xml) AND tells the plugin to auto-publish.
                    // A bare `mvn deploy` (without this property) does not activate the profile and does
                    // not reach Maven Central, so only CI publishes.
                    // With -Papi (5.0+), api and impl deploy in a single reactor invocation.
                    sh '#!/bin/bash -ex\n' + GPG_INIT + '''
                        mvn -U -B ${MVN_EXTRA} ${MVN_API_PROFILE} \\
                            -DskipTests -Ddoclint=none \\
                            -Dcentral.autoPublish=true \\
                            -pl impl -am deploy
                    '''
                }
            }
        }

        stage('Bump to next snapshot') {
            steps {
                sshagent(credentials: ['github-bot-ssh']) {
                    // Same ordering as Build & install: faces commit FIRST so the mojarra bump commit
                    // picks up the updated submodule gitlink alongside its own pom change.
                    script {
                        if (env.SHOULD_BUILD_API == 'true') {
                            dir('faces') {
                                sh '''#!/bin/bash -ex
                                    mvn -U -B ${MVN_EXTRA} -f api/pom.xml \\
                                        -DnewVersion="${NEXT_API_VERSION}" -DgenerateBackupPoms=false \\
                                        ${VERSIONS_PLUGIN}:set
                                    git add -A '*pom.xml'
                                    git commit -m "Prepare next development cycle for ${NEXT_API_VERSION}"
                                '''
                            }
                        }
                    }
                    sh '''#!/bin/bash -ex
                        mvn -U -B ${MVN_EXTRA} \\
                            -DnewVersion="${NEXT_VERSION}" -DgenerateBackupPoms=false \\
                            ${VERSIONS_PLUGIN}:set
                        git add -A '*pom.xml'
                        if [ -d faces ]; then
                            git add faces
                        fi
                        git commit -m "Prepare next development cycle for ${NEXT_VERSION}"
                    '''
                }
            }
        }

        stage('Publish to GitHub') {
            when { expression { return !params.DRY_RUN } }
            steps {
                sshagent(credentials: ['github-bot-ssh']) {
                    sh '''#!/bin/bash -ex
                        git push origin "${RELEASE_BRANCH}"
                        git push origin "${RELEASE_TAG}"
                    '''
                    script {
                        if (env.SHOULD_BUILD_API == 'true') {
                            dir('faces') {
                                sh '''#!/bin/bash -ex
                                    git push origin "${API_RELEASE_BRANCH}"
                                    git push origin "${API_RELEASE_TAG}"
                                '''
                            }
                        }
                    }
                }
            }
        }
    }

    post {
        success { echo "Released ${env.RELEASE_VERSION} from branch ${params.BRANCH}." }
        failure { echo "Release of ${env.RELEASE_VERSION} from ${params.BRANCH} FAILED." }
    }
}

// Bump the last numeric component of a dotted version. "5.0.0" -> "5.0.1", "4.1.10" -> "4.1.11".
// Caller must ensure the last component is numeric (see requireGaVersion).
def bumpLastComponent(String version) {
    def parts = version.tokenize('.')
    parts[-1] = (parts[-1].toInteger() + 1).toString()
    return parts.join('.')
}

// Validate that `version` is a dotted-numeric GA version with at least three components (rejects
// -M2/-RC1 and ambiguous two-component values like "5.0" that would bumpLastComponent to a minor
// rather than a patch). If `expectedPrefix` is non-null, also verify the version starts with
// `expectedPrefix + '.'`. Aborts the build on mismatch.
def requireGaVersion(String paramName, String version, String expectedPrefix) {
    if (!(version ==~ /\d+\.\d+\.\d+(\.\d+)*/)) {
        error "${paramName} '${version}' is not a dotted-numeric GA version with at least 3 components (e.g. 4.1.5). Milestone/RC and two-component versions are not supported."
    }
    if (expectedPrefix != null && !version.startsWith(expectedPrefix + '.')) {
        error "${paramName} '${version}' does not match expected prefix '${expectedPrefix}.'."
    }
}

// Mirror of the TCK pom's `compute-csp-backport-flags` script (faces/tck/pom.xml, in profile
// glassfish-ci-managed). Returns the `-Dit.test=... -Dfailsafe.failIfNoSpecifiedTests=false`
// flags string when `version` falls in the CSP-backport range (Mojarra 4.0.17+ or 4.1.8+),
// or "" otherwise. See env.TCK_IT_TEST_FLAGS for context.
def cspBackportItTestFlags(String version) {
    def m = (version =~ /^(\d+)\.(\d+)\.(\d+)$/)
    if (!m.matches()) return ''
    def maj = m[0][1].toInteger()
    def min = m[0][2].toInteger()
    def inc = m[0][3].toInteger()
    if ((maj == 4 && min == 0 && inc >= 17) || (maj == 4 && min == 1 && inc >= 8)) {
        return '-Dit.test=**/*IT.java,!**/Issue2439IT.java,!**/Issue2674IT.java,!**/Issue4331IT.java,!**/Spec1238IT.java,!**/CommandLinkTestsIT.java -Dfailsafe.failIfNoSpecifiedTests=false'
    }
    return ''
}

// Read impl/pom.xml's <dependency> block for jakarta.faces:jakarta.faces-api and return its <version>
// literal. Returns "" if the dep is not declared. Assumes a literal <version> (not a property reference).
// Uses readMavenPom from the Pipeline Utility Steps plugin (pre-approved by Jenkins script-security)
// instead of XmlSlurper, which would require manual approval on a fresh controller.
def readImplApiDepVersion() {
    def pom = readMavenPom(file: 'impl/pom.xml')
    for (dep in pom.dependencies) {
        if (dep.groupId == 'jakarta.faces' && dep.artifactId == 'jakarta.faces-api') {
            // ?: '' guards against the case where the version is null (managed via dependencyManagement
            // or a BOM); the caller's "" check then triggers a clear error instead of a NullPointerException.
            return dep.version ?: ''
        }
    }
    return ''
}
