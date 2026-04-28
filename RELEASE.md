# Releasing a new Mojarra version

The release pipeline is the single [`Jenkinsfile`](https://github.com/eclipse-ee4j/mojarra/blob/master/Jenkinsfile) at the repo root, run as a Jenkins multibranch / pipeline job (it replaces the legacy 3-job chain `1_mojarra-build-and-stage` → `2_mojarra-run-tck-against-staged-build_*` → `3_mojarra-staging-to-release`).

It does, in one run:

1. **Prepare** — checkout, JDK selection, version resolution (impl, and on 5.0+ also `jakarta.faces-api` via the `faces/` submodule), CSP-backport TCK exclusion fallback for 4.0.17+ / 4.1.8+ (mirrors `compute-csp-backport-flags` in the TCK pom for the existing TCK zips that predate the script).
2. **Build & install** — single Maven reactor (`-pl impl -am`); on 5.0+ adds `-Papi` to also build `jakarta.faces-api` from the submodule. Tags are created locally; pushes happen later.
3. **TCK** — downloads the published TCK zip from `download.eclipse.org/jakartaee/faces/<family>/`, bootstraps Chrome-for-Testing into the workspace for the Selenium-driven `BaseITNG` tests (Eclipse CI agents ship no browser), and runs the TCK against the locally-installed impl. Fails the build on any TCK failure or error. Archives `run.log`. The Chrome version is auto-detected from the unzipped TCK's `ChromeDevtoolsDriver.java` CDP import — the matching milestone is resolved via Chrome-for-Testing's published JSON, then Chrome and its Debian/Ubuntu runtime libs are pulled into the workspace via `apt-get download` (no root needed). When the TCK pins a CDP major older than CfT's catalog (e.g. 4.0's v108), the bootstrap falls back to `-Dtest.selenium=false` so the BaseITNG suite self-skips instead of failing on driver init.
4. **TCK report** — runs `maven-site-plugin:site` against the just-completed TCK reactor to render `failsafe-report.html`, then parses it into the human-readable `summary.txt` (passed/failed/errors counts, SHAs of TCK zip and the produced `jakarta.faces.jar`, JDK and OS info). Split out from the TCK stage so a TCK failure fails fast without spending minutes on report rendering.
5. **Deploy to Maven Central** *(skipped on `DRY_RUN`)* — `mvn deploy -Dcentral.autoPublish=true`, so the bundle auto-publishes on success rather than parking in the Portal staging area.
6. **Bump to next snapshot** — `versions:set` to the next `-SNAPSHOT` and commit on the release branch (and the `faces/` submodule on 5.0+).
7. **Publish to GitHub** *(skipped on `DRY_RUN`)* — push the release branch, the release tag, and (on 5.0+) the same for the `jakarta.faces-api` submodule.

Maven Central deploy and GitHub push only run after the TCK passes, so a failed TCK leaves no half-published external state.

## How to run

In the example below we assume releasing **Mojarra 4.0.17**.

1. Sanity-check the version isn't already in [Maven Central](https://repo1.maven.org/maven2/org/glassfish/jakarta.faces/) — if it is, bump the version.
2. Go to [Mojarra CI](https://ci.eclipse.org/mojarra/) and [log in](https://ci.eclipse.org/mojarra/login?from=%2Fmojarra%2F).
3. Open the [`mojarra-release`](https://ci.eclipse.org/mojarra/job/mojarra-release/) job and click **Build with parameters**. For a normal release set only `BRANCH`; every other parameter can be left at its default and is auto-inferred:
   - `BRANCH` = `4.0` (choices: `4.0`, `4.1`, `master`; `master` currently maps to 5.0)
4. *(Optional)* In case you wish to fine-tune the run, override one or more of:
   - `RELEASE_VERSION` — e.g. `4.0.17`. Default: stripped from `pom.xml`'s top-level version (`-SNAPSHOT` removed).
   - `JDK` — build JDK. Default: 11 for 4.0, 17 for 4.1 and master.
   - `TCK_JDK` — JDK that runs the TCK (the GlassFish container can need a newer one than the spec). Default: 11 for 4.0, 21 for 4.1 and master.
   - `TCK_VERSION`, `GF_VERSION` — TCK and GlassFish coordinate versions. Default: per-branch (see table below).
   - `GF_BUNDLE_URL` — alternative GlassFish zip URL. If set, also set `GF_VERSION` to match the artifact version inside the zip.
   - `CHROME_VERSION` — Chrome-for-Testing version override (e.g. `139.0.7258.155`). Default: blank, which auto-detects from the unzipped TCK's `ChromeDevtoolsDriver.java` CDP import. Set to literal `none` to skip Chrome install and force `-Dtest.selenium=false` (the same path 4.0 takes automatically).
   - `API_RELEASE_VERSION` — 5.0+ only. Default: stripped from `faces/api/pom.xml`. Ignored when `impl/pom.xml` already pins `jakarta.faces-api` to a GA version (impl-only patch release, no new API artifact cut).
   - `RUN_TCK` — uncheck to skip the TCK stage. Default: checked.
   - `DRY_RUN` — check to do everything except Maven Central deploy and GitHub push (useful for rehearsals; locally installs the artifacts and runs the TCK against them). Default: unchecked.
   - `OVERWRITE` — check only if you need to replace an existing release branch / tag on origin (e.g. retrying after a failed run). Default: unchecked.
5. Click **Build**.
6. Wait for the run to finish. The build description shows a one-line summary, e.g. `4.0 → 4.0.17 (impl-only) (JDK11, GF 7.0.25, TCK 4.0.3)`.
7. On success, verify:
   - Artifact in [Maven Central](https://repo1.maven.org/maven2/org/glassfish/jakarta.faces/) (may take up to an hour to surface).
   - Release branch `4.0.17` and tag `4.0.17-RELEASE` on [GitHub](https://github.com/eclipse-ee4j/mojarra/branches/active).
   - On 5.0+ releases that also cut the API: matching branch / tag in [jakartaee/faces](https://github.com/jakartaee/faces/branches/active) for the `jakarta.faces-api` version.
8. Open a PR to merge the `4.0.17` release branch back into `4.0`, then delete the release branch after merge.
9. Manage the [milestones](https://github.com/eclipse-ee4j/mojarra/milestones) page:
   - make sure all issues / PRs are linked to the proper milestone
   - close milestones that were just released
   - create new milestones for upcoming releases
10. Draft a new [GitHub Release](https://github.com/eclipse-ee4j/mojarra/releases/new):
   - **Choose a tag** — pick the just-created `4.0.17-RELEASE` from the dropdown.
   - **Target** — `4.0` (the branch the tag lives on).
   - **Release title** — `4.0.17`.
   - **Describe this release** — click *Generate release notes* to auto-populate from the PRs / commits since the previous `*-RELEASE` tag, then tidy up:
     - one-line summary at the top, e.g. `Released 4.0.17.`
     - link to Maven Central: `https://repo1.maven.org/maven2/org/glassfish/jakarta.faces/4.0.17/`
     - link to the closed milestone on the [milestones page](https://github.com/eclipse-ee4j/mojarra/milestones?state=closed)
     - flag any breaking changes / migration notes
   - **Set as a pre-release** — leave unchecked for GA releases.
   - **Set as the latest release** — leave checked only if this is the highest GA across all active branches. Uncheck when patching an older line (e.g. when releasing 4.0.17 while 4.1.x and/or 5.0.x are already out), otherwise it bumps "Latest" backwards.
   - Click **Publish release**.

## Per-branch defaults

Maintained in `BRANCH_CONFIG` at the top of the `Jenkinsfile`. Adding a new release line means adding one entry there. Current entries:

| Branch   | Family | Build JDK | TCK JDK | API submodule branch | API version | TCK version | GlassFish |
| -------- | ------ | --------- | ------- | -------------------- | ----------- | ----------- | --------- |
| `4.0`    | 4.0    | 11        | 11      | — (API was bundled)  | 4.0.1       | 4.0.3       | 7.0.25    |
| `4.1`    | 4.1    | 17        | 21      | — (API was bundled)  | 4.1.0       | 4.1.0       | 8.0.0-M6  |
| `master` | 5.0    | 17        | 21      | `5.0` (in `faces/`)  | 5.0.0       | 5.0.0       | 9.0.0-M2  |

API version is the value passed as `-Dfaces.version` to the TCK build (the published `jakarta.faces-api` jar version that the TCK compiles against). On 4.x the API was bundled with the impl, so this is just the GA on Maven Central. On 5.0+ it tracks the standalone `jakarta.faces-api` artifact — bump it together with the matching API release.

## Troubleshooting

- **Release branch / tag already exists on origin.** Either pick a different `RELEASE_VERSION`, or re-run with `OVERWRITE=true` to delete and recreate it.
- **TCK failures.** The TCK stage fails on the failsafe exit code; the TCK report stage doesn't run, so only `run.log` is archived (no `summary.txt`). Maven Central deploy and GitHub push are skipped, so no external state was published.
- **All `BaseITNG` tests skipping unexpectedly.** Means the Chrome bootstrap fell into the no-Chrome path. Either the TCK's CDP major isn't in Chrome-for-Testing's catalog (expected for 4.0; not for 4.1+), or the milestone JSON fetch failed silently. Inspect the `[chrome-bootstrap]` lines near the start of the TCK stage in `run.log` — they print the detected CDP version and the resolved Chrome version. Override with `CHROME_VERSION=<exact CfT build>` if needed.
- **`SessionNotCreatedException: ChromeDriver only supports Chrome version N`.** The TCK's bundled `WebDriverManager` fetched a chromedriver of a different major than the installed Chrome. The TCK stage passes `-Dwdm.chromeDriverVersion=<resolved>` to keep them aligned; if you see this anyway, the TCK release likely changed how it resolves the driver. Override `CHROME_VERSION` to match what WDM is actually fetching.
- **Java version mismatch on a developer rerun.** The pipeline picks the JDK from `BRANCH_CONFIG` (or the `JDK` / `TCK_JDK` overrides). If you're reproducing a failure locally, match those.
- **Need to rehearse without publishing.** Set `DRY_RUN=true`. The pipeline still does the full build, version bumps, tagging, and TCK run, but skips the Maven Central deploy and the `git push origin` of the release branch / tag.
