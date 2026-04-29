#!/usr/bin/env groovy
//
// Mojarra release pipeline.
//
// Stages: Prepare -> Build & install -> TCK -> Deploy to Maven Central -> Bump to next snapshot
//   -> Publish to GitHub. Maven Central deploy and GitHub push run only after the TCK passes,
//   so a TCK failure leaves no half-published external state.
//
// On 5.0+ the standalone jakarta.faces-api lives in jakartaee/faces and is wired in as a git
// submodule at faces/. The `api` profile on the mojarra-parent pom adds it to the reactor; with
// `-Papi`, a single `mvn install`/`deploy` builds and publishes both artifacts. `versions:set`
// runs twice — once on the mojarra reactor (cascades to impl) and once on faces/api/pom.xml
// directly, because faces/api has a different parent (org.eclipse.ee4j:project).
//
// Whether to release the API alongside the impl is auto-inferred from impl/pom.xml's
// jakarta.faces-api dependency version: -SNAPSHOT triggers a joint release, a GA version means
// impl-only.
//
// Maven Central publication is gated by -Dcentral.autoPublish=true (set only by this Jenkinsfile).
// A bare `mvn deploy -Pcentral-release` from a developer machine stages the bundle in the Portal
// but does NOT publish.
//

// JDK install root layout on Eclipse CI: /opt/tools/java/<prefix>/jdk-<N>/latest. Prefix is a
// function of major version, used for both the build JDK and the TCK JDK.
def JAVA_PREFIX_BY_JDK = [
    '11': 'openjdk',
    '17': 'openjdk',
    '21': 'temurin',
]

// ---- Per-branch configuration ---------------------------------------------
// Adding a new release line = one entry here.
//
// Fields:
//   versionFamily   : MAJOR.MINOR family this branch represents (mojarra "master" maps to "5.0").
//                     Used as the path segment on download.eclipse.org/jakartaee/faces/<here>/
//                     and as the required prefix for RELEASE_VERSION.
//   jdk             : major JDK version used to build the impl (per Faces spec).
//   tckJdk          : major JDK version used to run the TCK. Differs from jdk when the GlassFish
//                     container needs a newer JDK than the spec.
//   apiBranch       : faces-repo branch for the standalone jakarta.faces-api jar (null when no
//                     separate API artifact exists for this branch). Must match .gitmodules.
//   facesVersion    : -Dfaces.version passed to the TCK build.
//   tckVersion      : Faces TCK release version.
//   gfVersion       : GlassFish Maven coordinate version used by the TCK.
//   seleniumEnabled : whether the BaseITNG (Selenium/Chrome) tests run. The agent pod ships
//                     current Chrome; set false for branches whose TCK pins a CDP major outside
//                     Selenium's fudge range (e.g. 4.0 pins CDP v108).
def BRANCH_CONFIG = [
    '4.0'   : [ versionFamily: '4.0', jdk: '11', tckJdk: '11', apiBranch: null,  facesVersion: '4.0.1', tckVersion: '4.0.3', gfVersion: '7.0.25'  , seleniumEnabled: false ],
    '4.1'   : [ versionFamily: '4.1', jdk: '17', tckJdk: '21', apiBranch: null,  facesVersion: '4.1.0', tckVersion: '4.1.0', gfVersion: '8.0.0-M6', seleniumEnabled: true  ],
    'master': [ versionFamily: '5.0', jdk: '17', tckJdk: '21', apiBranch: '5.0', facesVersion: '5.0.0', tckVersion: '5.0.0', gfVersion: '9.0.0-M2', seleniumEnabled: true  ],
]

// Reusable shell snippet: GPG keyring import + trust. Idempotent. Required wherever the build
// signs artifacts (javadoc/sources in Build & install, everything in Deploy to Maven Central).
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

// Reusable shell snippet: refuse to start the release if origin already carries this version's
// branch or tag. Recovery for any such conflict is to bump RELEASE_VERSION and re-run.
// Expects bash variables BRANCH_NAME and TAG_NAME to be set in the surrounding script.
def REMOTE_REF_CONFLICT_CHECK = '''
    if [ "${DRY_RUN}" != "true" ]; then
        if git ls-remote --heads origin | grep -q "refs/heads/${BRANCH_NAME}$"; then
            echo "Release branch ${BRANCH_NAME} already exists on origin; bump RELEASE_VERSION." >&2; exit 1
        fi
        if git ls-remote --tags origin | grep -q "refs/tags/${TAG_NAME}$"; then
            echo "Release tag ${TAG_NAME} already exists on origin; bump RELEASE_VERSION." >&2; exit 1
        fi
    fi
    git branch -D "${BRANCH_NAME}" 2>/dev/null || true
    git tag    -d "${TAG_NAME}"    2>/dev/null || true
    git checkout -b "${BRANCH_NAME}"
'''

pipeline {
    // Run the entire pipeline inside a kubernetes pod with Chrome pre-installed, so the TCK's
    // BaseITNG (Selenium) tests can drive a real browser without us bootstrapping it.
    // eclipsecbijenkins/basic-ubuntu-chrome layers Chrome onto jiro-agent-basic-ubuntu, so the
    // standard Eclipse CI tooling layout (/opt/tools/java, /opt/tools/apache-maven, settings.xml
    // mounts) is preserved.
    agent {
        kubernetes {
            label 'mojarra-release-pod'
            defaultContainer 'jnlp-with-chrome'
            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: jnlp-with-chrome
      image: 'eclipsecbijenkins/basic-ubuntu-chrome:latest'
      tty: true
      command:
        - cat
      env:
        - name: HOME
          value: /home/jenkins
      resources:
        limits:
          memory: 8Gi
          cpu: '2'
        requests:
          memory: 8Gi
          cpu: '2'
      volumeMounts:
        - name: jenkins-home
          mountPath: /home/jenkins
          readOnly: false
        - name: settings-xml
          mountPath: /home/jenkins/.m2/settings.xml
          subPath: settings.xml
          readOnly: true
        - name: m2-repo
          mountPath: /home/jenkins/.m2/repository
        - name: tools
          mountPath: /opt/tools
  volumes:
    - name: jenkins-home
      emptyDir: {}
    - name: settings-xml
      secret:
        secretName: m2-secret-dir
        items:
          - key: settings.xml
            path: settings.xml
    - name: m2-repo
      emptyDir: {}
    - name: tools
      persistentVolumeClaim:
        claimName: tools-claim-jiro-mojarra
"""
        }
    }

    parameters {
        choice(name: 'BRANCH',          choices: ['4.0', '4.1', 'master'],
               description: 'Branch to release. master is currently 5.0.')
        string(name: 'RELEASE_VERSION', defaultValue: '',
               description: 'Leave blank to auto-infer from parent pom.xml (strips -SNAPSHOT). Must be a dotted-numeric GA version (e.g. 4.1.5); milestone/RC versions are not supported.')
        choice(name: 'JDK',             choices: ['', '11', '17', '21'],
               description: 'Leave blank to auto-infer from BRANCH (11 for 4.0, 17 for 4.1, 17 for master). This is the JDK used to run the build & install.')
        choice(name: 'TCK_JDK',         choices: ['', '11', '17', '21'],
               description: 'Leave blank to auto-infer from BRANCH (17 for 4.0, 21 for 4.1 and master). This is the JDK used to run the TCK (the GlassFish container may need a newer JDK than the spec).')
        string(name: 'TCK_VERSION',     defaultValue: '',
               description: 'Leave blank to auto-infer from BRANCH.')
        string(name: 'GF_VERSION',      defaultValue: '',
               description: 'Leave blank to auto-infer from BRANCH. When using GF_BUNDLE_URL, set this to match the artifact version inside the zip (e.g. 8.0.0-X).')
        string(name: 'GF_BUNDLE_URL',   defaultValue: '',
               description: 'Optional GlassFish zip URL override. If set, GF_VERSION must also be set to match.')
        string(name: 'API_RELEASE_VERSION', defaultValue: '',
               description: '5.0+ only. Leave blank to auto-infer from faces/api/pom.xml. Ignored when impl/pom.xml pins jakarta.faces-api to a GA version (impl-only release).')
        booleanParam(name: 'RUN_TCK',     defaultValue: true,  description: 'Run the Faces TCK after build.')
        booleanParam(name: 'SKIP_OLD_TCK', defaultValue: true, description: 'Skip the old-tck module (-Dtck.old.skip=true); cuts at least 2 hours off the TCK run on 4.0/4.1. No-op on 5.0+ where the old-tck module no longer exists.')
        booleanParam(name: 'DRY_RUN',     defaultValue: true,  description: 'Skip Maven Central deploy and GitHub push (locally installs the artifacts instead). Run TCK against the local install.')
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
                    env.SELENIUM_ENABLED     = cfg.seleniumEnabled ? 'true' : 'false'
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
                // Mojarra checkout. When .gitmodules is present (5.0+), initialize the faces/ submodule
                // tracking the configured branch tip rather than the recorded SHA — the release should
                // pull the latest API code, not whatever was pinned at last commit.
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

                    // Mirror the TCK pom's `compute-csp-backport-flags` script for Mojarra versions
                    // covered by the CSP backport (#5606): a handful of TCK ITs need to be excluded
                    // because their inline event handlers no longer hold once mojarra.ael attaches them.
                    // Pre-setting `it.test` here is also safe against TCK zips that already ship the
                    // script — its guard is `!containsKey('it.test')`, which we then trigger as a no-op.
                    env.TCK_IT_TEST_FLAGS = cspBackportItTestFlags(env.RELEASE_VERSION)

                    env.SKIP_OLD_TCK_FLAG = params.SKIP_OLD_TCK ? '-Dtck.old.skip=true' : ''

                    // Auto-infer SHOULD_BUILD_API from impl/pom.xml's jakarta.faces-api dep version: a
                    // -SNAPSHOT dep means the API is unreleased and must be released alongside; a GA
                    // version means the API is on Maven Central and this is an impl-only release.
                    // Skipped when no separate API artifact exists for this branch (apiBranch == null).
                    if (cfg.apiBranch != null) {
                        def apiDepVersion = readImplApiDepVersion()
                        if (apiDepVersion == '') {
                            error "impl/pom.xml does not declare a jakarta.faces-api dependency. Cannot determine whether to release the API."
                        }
                        env.IMPL_API_DEP_VERSION = apiDepVersion
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
                    env.MVN_API_PROFILE = (env.SHOULD_BUILD_API == 'true') ? '-Papi' : ''

                    // Resolve API_RELEASE_VERSION from faces/api/pom.xml when releasing the API.
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
                    def tckLabel = params.RUN_TCK ? "TCK ${env.RESOLVED_TCK_VERSION}" : "TCK skipped"
                    def dryRunLabel = params.DRY_RUN ? ', dry-run' : ''
                    currentBuild.description = "${params.BRANCH} → ${env.RELEASE_VERSION}" +
                        ((env.SHOULD_BUILD_API == 'true') ? " + API ${env.RESOLVED_API_VERSION}" : ' (impl-only)') +
                        " (${jdkLabel}, GF ${env.RESOLVED_GF_VERSION}, ${tckLabel}${dryRunLabel})"
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
                        // Mojarra: GPG init + git identity + branch/tag conflict check + local release branch.
                        sh '#!/bin/bash -ex\nexport BRANCH_NAME="${RELEASE_BRANCH}" TAG_NAME="${RELEASE_TAG}"\n' +
                           GPG_GIT_INIT + REMOTE_REF_CONFLICT_CHECK
                        // Same ceremony for the faces submodule when releasing the API alongside.
                        script {
                            if (env.SHOULD_BUILD_API == 'true') {
                                dir('faces') {
                                    sh '#!/bin/bash -ex\nexport BRANCH_NAME="${API_RELEASE_BRANCH}" TAG_NAME="${API_RELEASE_TAG}"\n' +
                                       GIT_IDENTITY + REMOTE_REF_CONFLICT_CHECK
                                }
                            }
                        }
                        // Set release versions. Mojarra parent's versions:set cascades to impl; faces/api
                        // has a different parent so it needs its own call. Then pin impl's jakarta.faces-api
                        // dep to the just-set API version.
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
                        // Commit faces FIRST so its HEAD advances; the mojarra commit below then picks
                        // up the updated submodule gitlink alongside its pom changes, so the mojarra
                        // release tag references the matching faces release commit.
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
                            # Stage the updated faces submodule gitlink when present.
                            if [ -d faces ]; then
                                git add faces
                            fi
                            git commit -m "Prepare release ${RELEASE_VERSION}"
                        '''
                        // Single-reactor build & install. With -Papi, faces/api joins the reactor and
                        // -pl impl -am pulls it in as a dependency.
                        sh '''#!/bin/bash -ex
                            mvn -U -B ${MVN_EXTRA} ${MVN_API_PROFILE} \\
                                -DskipTests -Ddoclint=none \\
                                -pl impl -am clean install
                        '''
                        // Tag locally; the push is deferred to "Publish to GitHub" after Maven Central deploy.
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
                    # GlassFish may need a newer JDK than the impl was built with.
                    export JAVA_HOME="${TCK_JAVA_HOME}"
                    export PATH="${JAVA_HOME}/bin:${PATH}"

                    rm -rf "faces-tck-${RESOLVED_TCK_VERSION}"
                    mkdir -p download
                    TCK_BUNDLE_NAME="jakarta-faces-tck-${RESOLVED_TCK_VERSION}"
                    TCK_BUNDLE_DIR="faces-tck-${RESOLVED_TCK_VERSION}"
                    TCK_URL="https://download.eclipse.org/jakartaee/faces/${VERSION_FAMILY}/${TCK_BUNDLE_NAME}.zip"

                    wget -q "${TCK_URL}" -O "download/${TCK_BUNDLE_NAME}.zip"
                    unzip -q -o "download/${TCK_BUNDLE_NAME}.zip"

                    # Workaround for an upstream TCK packaging typo: tck/faces23/converter/pom.xml
                    # declares <finalName>test-faces23-ajax</finalName>, colliding with the ajax
                    # module's deploy and breaking Issue4070IT. Drop once a fixed TCK zip ships and
                    # BRANCH_CONFIG.tckVersion is bumped past it.
                    CONVERTER_POM="${TCK_BUNDLE_DIR}/tck/faces23/converter/pom.xml"
                    if [ -f "${CONVERTER_POM}" ] && grep -q "<finalName>test-faces23-ajax</finalName>" "${CONVERTER_POM}"; then
                        sed -i.bak 's|<finalName>test-faces23-ajax</finalName>|<finalName>test-faces23-converter</finalName>|' "${CONVERTER_POM}"
                        echo "[tck-patch] fixed finalName typo in ${CONVERTER_POM}"
                    fi

                    if [ -n "${GF_BUNDLE_URL}" ]; then
                        wget -q "${GF_BUNDLE_URL}" -O glassfish.zip
                        mvn ${MVN_EXTRA} install:install-file -Dfile=./glassfish.zip \\
                            -DgroupId=org.glassfish.main.distributions \\
                            -DartifactId=glassfish -Dversion="${RESOLVED_GF_VERSION}" -Dpackaging=zip
                    fi

                    # Failsafe gates on test failures via its own non-zero exit; report rendering is
                    # deferred to the next stage so a TCK failure fails fast.
                    cd "${TCK_BUNDLE_DIR}/tck"
                    mvn ${MVN_EXTRA} clean install \\
                        ${SKIP_OLD_TCK_FLAG} -Dtest.selenium=${SELENIUM_ENABLED} \\
                        -Dwdm.cachePath=/home/jenkins/agent/caches/selenium \\
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
                        ${SKIP_OLD_TCK_FLAG} \\
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

                    # Defense-in-depth: catch any future change that adds -Dmaven.test.failure.ignore=true.
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
                    // -Dcentral.autoPublish=true activates the central-release profile (via property
                    // activation in impl/pom.xml and faces/api/pom.xml) AND tells the plugin to publish.
                    // Without this property, `mvn deploy` does not activate the profile and does not
                    // reach Maven Central, so only CI publishes.
                    // With -Papi, api and impl deploy in a single reactor invocation.
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
                    // Commit faces FIRST so the mojarra bump commit picks up the updated submodule
                    // gitlink alongside its own pom change.
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
                // Squash-merge the release branch into the source branch so "Prepare release" +
                // "Prepare next development cycle" land as a single commit titled "<version> has been
                // released". The tag still references the original commits on the release branch.
                // For the API repo, only PR-merge when impl/pom.xml's jakarta.faces-api dep matches
                // faces/api/pom.xml's version (i.e. impl + api are in lockstep); if they diverge we
                // still push the API release branch but skip the PR-merge to avoid landing an
                // unrelated version on the API source branch.
                withCredentials([string(credentialsId: 'github-bot-token', variable: 'GH_TOKEN')]) {
                    sh '''#!/bin/bash -ex
                        gh pr create --base "${BRANCH}" --head "${RELEASE_BRANCH}" \\
                            --title "Mojarra ${RELEASE_VERSION} has been released" \\
                            --body "${BUILD_URL}"
                        gh pr merge "${RELEASE_BRANCH}" --squash \\
                            --subject "Mojarra ${RELEASE_VERSION} has been released" \\
                            --body "${BUILD_URL}"
                    '''
                    // Close the just-released milestone (if it exists), open a milestone for the next
                    // snapshot, and draft+publish a GitHub release at the just-pushed tag with
                    // auto-generated notes prepended by a one-line summary, the Maven Central link, and
                    // a link to the closed milestone. Best-effort on milestones — a missing or
                    // pre-existing milestone must not fail this stage. --latest=false because patches
                    // may be released across multiple branches in any order.
                    sh '''#!/bin/bash -ex
                        NEXT_MILESTONE="${NEXT_VERSION%-SNAPSHOT}"
                        REPO_SLUG=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

                        MILESTONE_NUMBER=$(gh api "repos/{owner}/{repo}/milestones?state=open&per_page=100" \\
                            --jq ".[] | select(.title==\\"${RELEASE_VERSION}\\") | .number")
                        if [ -n "${MILESTONE_NUMBER}" ]; then
                            gh api -X PATCH "repos/{owner}/{repo}/milestones/${MILESTONE_NUMBER}" -f state=closed
                        else
                            echo "No open milestone titled '${RELEASE_VERSION}' to close; skipping."
                        fi

                        if gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" \\
                                --jq ".[] | select(.title==\\"${NEXT_MILESTONE}\\") | .number" | grep -q .; then
                            echo "Milestone '${NEXT_MILESTONE}' already exists; skipping create."
                        else
                            gh api -X POST "repos/{owner}/{repo}/milestones" -f title="${NEXT_MILESTONE}"
                        fi

                        # Anchor the auto-generated notes to the previous *-RELEASE tag in the same
                        # major.minor family; otherwise GitHub picks the most recent semver tag
                        # repo-wide, which may belong to a different release line.
                        PREVIOUS_TAG=$(git tag -l "${VERSION_FAMILY}.*-RELEASE" \\
                            | grep -v "^${RELEASE_TAG}$" | sort -V | tail -1)
                        if [ -n "${PREVIOUS_TAG}" ]; then
                            GENERATED=$(gh api -X POST "repos/{owner}/{repo}/releases/generate-notes" \\
                                -f tag_name="${RELEASE_TAG}" -f target_commitish="${BRANCH}" \\
                                -f previous_tag_name="${PREVIOUS_TAG}" --jq .body)
                        else
                            GENERATED=$(gh api -X POST "repos/{owner}/{repo}/releases/generate-notes" \\
                                -f tag_name="${RELEASE_TAG}" -f target_commitish="${BRANCH}" --jq .body)
                        fi

                        {
                            echo "${RELEASE_VERSION} has been released"
                            echo
                            echo "Maven Central: https://repo1.maven.org/maven2/org/glassfish/jakarta.faces/${RELEASE_VERSION}/"
                            if [ -n "${MILESTONE_NUMBER}" ]; then
                                echo "Milestone: https://github.com/${REPO_SLUG}/milestone/${MILESTONE_NUMBER}?closed=1"
                            fi
                            echo
                            echo "${GENERATED}"
                        } > release-notes.md

                        gh release create "${RELEASE_TAG}" --target "${BRANCH}" \\
                            --title "${RELEASE_VERSION}" \\
                            --notes-file release-notes.md \\
                            --latest=false
                    '''
                    script {
                        if (env.SHOULD_BUILD_API == 'true' && env.IMPL_API_DEP_VERSION == env.API_SNAPSHOT_VERSION) {
                            dir('faces') {
                                sh '''#!/bin/bash -ex
                                    gh pr create --base "${API_BRANCH}" --head "${API_RELEASE_BRANCH}" \\
                                        --title "Faces API ${RESOLVED_API_VERSION} has been released" \\
                                        --body "${BUILD_URL}"
                                    gh pr merge "${API_RELEASE_BRANCH}" --squash \\
                                        --subject "Faces API ${RESOLVED_API_VERSION} has been released" \\
                                        --body "${BUILD_URL}"
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

// Bump the last numeric component of a dotted version: "5.0.0" -> "5.0.1", "4.1.10" -> "4.1.11".
// Caller must ensure the last component is numeric (see requireGaVersion).
def bumpLastComponent(String version) {
    def parts = version.tokenize('.')
    parts[-1] = (parts[-1].toInteger() + 1).toString()
    return parts.join('.')
}

// Validate that `version` is a dotted-numeric GA version with at least three components (rejects
// -M2/-RC1 and ambiguous two-component values like "5.0" which would bumpLastComponent to a minor
// rather than a patch). When `expectedPrefix` is non-null, also verifies the prefix match.
// Aborts the build on mismatch.
def requireGaVersion(String paramName, String version, String expectedPrefix) {
    if (!(version ==~ /\d+\.\d+\.\d+(\.\d+)*/)) {
        error "${paramName} '${version}' is not a dotted-numeric GA version with at least 3 components (e.g. 4.1.5). Milestone/RC and two-component versions are not supported."
    }
    if (expectedPrefix != null && !version.startsWith(expectedPrefix + '.')) {
        error "${paramName} '${version}' does not match expected prefix '${expectedPrefix}.'."
    }
}

// Mirror of the TCK pom's `compute-csp-backport-flags` script (faces/tck/pom.xml, profile
// glassfish-ci-managed). Returns the `-Dit.test=... -Dfailsafe.failIfNoSpecifiedTests=false`
// flags when `version` falls in the CSP-backport range (4.0.17+ or 4.1.8+), or "" otherwise.
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

// Read impl/pom.xml's jakarta.faces:jakarta.faces-api dependency version literal. Returns "" if
// the dep is not declared or if its <version> is null (e.g. managed via dependencyManagement),
// letting the caller emit a clear error. Uses readMavenPom (pre-approved by Jenkins
// script-security) instead of XmlSlurper, which would require manual approval.
def readImplApiDepVersion() {
    def pom = readMavenPom(file: 'impl/pom.xml')
    for (dep in pom.dependencies) {
        if (dep.groupId == 'jakarta.faces' && dep.artifactId == 'jakarta.faces-api') {
            return dep.version ?: ''
        }
    }
    return ''
}
