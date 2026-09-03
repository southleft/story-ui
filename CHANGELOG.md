## [5.0.7](https://github.com/southleft/story-ui/compare/v5.0.6...v5.0.7) (2026-09-03)


### Bug Fixes

* **check:** prove Storybook's file watcher live; drop the 10.5.x version rule ([a39d477](https://github.com/southleft/story-ui/commit/a39d477d3c19773bb0dbee3508ed351faa428dca))
* **cli:** init and update make Storybook's index watcher poll on macOS; check proves it live ([a46c1d5](https://github.com/southleft/story-ui/commit/a46c1d57260b0aa66c00a3f45d4f939362622ab8))

## [5.0.6](https://github.com/southleft/story-ui/compare/v5.0.5...v5.0.6) (2026-09-03)


### Bug Fixes

* an existing voice-canvas story is refreshed at server start ([9a50230](https://github.com/southleft/story-ui/commit/9a50230652a0ff8eb5073977344ce70dacc6ecd2))

## [5.0.5](https://github.com/southleft/story-ui/compare/v5.0.4...v5.0.5) (2026-09-03)


### Bug Fixes

* voice canvas story stays out of the Storybook sidebar; index misses name the Storybook version ([17c56ed](https://github.com/southleft/story-ui/commit/17c56edaa533e1fcd557084f0d6118397f257a6a))

## [5.0.4](https://github.com/southleft/story-ui/compare/v5.0.3...v5.0.4) (2026-09-03)


### Bug Fixes

* **ui:** classic panel opts out of docs typography; semantic tokens defined in both schemes ([12f70dd](https://github.com/southleft/story-ui/commit/12f70ddf440c4c2ad74940362de1729679f2e44e)), closes [#2E3338](https://github.com/southleft/story-ui/issues/2E3338) [#6b7280](https://github.com/southleft/story-ui/issues/6b7280)

## [5.0.3](https://github.com/southleft/story-ui/compare/v5.0.2...v5.0.3) (2026-09-03)


### Bug Fixes

* canvas scope matches the catalog; panel waits for the server; deleted titles are free again ([6d1278d](https://github.com/southleft/story-ui/commit/6d1278d6f07bb53dd3a84d28289b5df18bc71e96))

## [5.0.2](https://github.com/southleft/story-ui/compare/v5.0.1...v5.0.2) (2026-09-03)


### Bug Fixes

* **cli:** prop knowledge cache invalidates on upgrade; Workspace entry opens Home; index wait fits Storybook 10.5.10 ([ff92857](https://github.com/southleft/story-ui/commit/ff92857a0e3eff471944bacc553456045a607ac4))
* knowledge cache invalidates on upgrade; Workspace entry opens Home; index wait matches Storybook 10.5.10 ([#33](https://github.com/southleft/story-ui/issues/33)) ([d660620](https://github.com/southleft/story-ui/commit/d660620a3b22ca90291b0b116c88cd78e23460e2))

## [5.0.1](https://github.com/southleft/story-ui/compare/v5.0.0...v5.0.1) (2026-09-03)


### Bug Fixes

* reopened classic chats no longer blank the panel; the Workspace entry opens the workspace ([#32](https://github.com/southleft/story-ui/issues/32)) ([2bf4ade](https://github.com/southleft/story-ui/commit/2bf4ade104db564cce1a4c6ec41e50aa6bf7dfa4))
* **ui:** reopened classic chats no longer blank the panel; the Workspace entry opens the workspace ([2109dfc](https://github.com/southleft/story-ui/commit/2109dfc132e211fe65577201ad08f2f2bfa1a206))

# [5.0.0](https://github.com/southleft/story-ui/compare/v4.17.0...v5.0.0) (2026-09-03)


* feat(release)!: require Storybook 10 or newer ([cc250e5](https://github.com/southleft/story-ui/commit/cc250e5c41529e5fa97b7436b8abf03c02a0c9b0))
* feat(release)!: Story UI 5 — the workspace, verification and a seamless install ([f37c171](https://github.com/southleft/story-ui/commit/f37c171d1ca4f7a01cffce99c454847c59590d5c))


### Bug Fixes

* **ci:** fidelity scorer treats type arguments and house components correctly ([348b7dc](https://github.com/southleft/story-ui/commit/348b7dcf9fed218c3742497ef02947f0b7f00bb5))
* **cli:** an unattended install on a custom library comes up working ([c937811](https://github.com/southleft/story-ui/commit/c9378119b24344aec13648018c9bdb85690c47d6))
* **cli:** import the Vite helpers update now uses ([b73bc61](https://github.com/southleft/story-ui/commit/b73bc611dbf8336866cd9ff7b36263d3205862cb))
* **cli:** init creates the generated stories directory; check counts props through the extractor ([0fee51d](https://github.com/southleft/story-ui/commit/0fee51d4ec7726ca6cfca2cc48c2109b4df3c06c))
* **cli:** init on a fresh Storybook project comes up right the first time ([f3d6d55](https://github.com/southleft/story-ui/commit/f3d6d559f4e9012052d33ba1d9f6ff0344cdf181))
* **cli:** init run from npx installs the package it came from ([ec2c990](https://github.com/southleft/story-ui/commit/ec2c990e6686fbd25b430fe335bb5015af4ecd7d))
* **cli:** ship a vite config the workspace can actually boot under ([2ccc819](https://github.com/southleft/story-ui/commit/2ccc819296204b3360726d61af18cb8f9a243b46))
* **cli:** update applies the Vite optimizeDeps block init writes ([f815715](https://github.com/southleft/story-ui/commit/f81571562140da5aa5b18bc83d6462eb9f5f3282))
* **cli:** update wires the manager addon even when files are current; runtime heals a bad importPath ([feacec1](https://github.com/southleft/story-ui/commit/feacec122e5eedae83df54a2d2b0d5daac6f938b))
* **generator:** a relative import that cannot be served is rewritten or refused, never written ([64b92e7](https://github.com/southleft/story-ui/commit/64b92e7d381c629cd1a9e9c2e7672641c43d3e92))
* **generator:** a render failure carries Vite's reason, not just the browser's symptom ([014fb08](https://github.com/southleft/story-ui/commit/014fb0870f90d4c1cc03e4a80877e2610e6aff07))
* **generator:** a restored conversation shows what the model said and what verification skipped ([ef1ef95](https://github.com/southleft/story-ui/commit/ef1ef95807f1d1ca9d7db8a270c3f6e703cbcc59))
* **generator:** a targeted edit stays targeted through verification and repair ([46ef6fa](https://github.com/southleft/story-ui/commit/46ef6fa6ad4433028c856db5124c3f25aeb294c4))
* **generator:** a verification that could not run must not look like a pass ([0b9d720](https://github.com/southleft/story-ui/commit/0b9d72006abab8d8577f0ecfd92f93b32177f1b5))
* **generator:** actually load Storybook's own component manifest ([8a4cca2](https://github.com/southleft/story-ui/commit/8a4cca2bdf97a7753334bda1e7f470579074f60e))
* **generator:** an open value set cannot reject a value ([384f014](https://github.com/southleft/story-ui/commit/384f014775c4ef5b0673b2e0e9ae815a93833014))
* **generator:** block unreadable text, and refuse emoji as iconography ([1f5ddee](https://github.com/southleft/story-ui/commit/1f5ddee8fcc530bd665ed865c9cc436ad90dc2bf))
* **generator:** build the dynamic import URL with pathToFileURL ([e0ef1bb](https://github.com/southleft/story-ui/commit/e0ef1bb74d3a7ebeaa1a4ac55cd0194f433f88c1))
* **generator:** change one attribute without rewriting the file ([0ff3754](https://github.com/southleft/story-ui/commit/0ff375439475a5f0277e18070ec57da9edf15673))
* **generator:** charge a defect to whoever rendered the markup ([27cc14f](https://github.com/southleft/story-ui/commit/27cc14fef44e27de2bd17acb35b792797565e75e))
* **generator:** close the property-panel dead ends found by live testing ([4c39400](https://github.com/southleft/story-ui/commit/4c39400813e523c418651b62b14d9969196dc933))
* **generator:** detect icons that render invisible against their background ([1113922](https://github.com/southleft/story-ui/commit/1113922d7179df881dbf810e22bbe0e4421bcd02))
* **generator:** find components on a cold start, with no Storybook running ([9ff0b64](https://github.com/southleft/story-ui/commit/9ff0b6445cc1d75787568a20795b7ca8fab12db8))
* **generator:** find components where Storybook says they are, not where we guess ([ab437d4](https://github.com/southleft/story-ui/commit/ab437d4c4159726ca8f5e1638133118c2acd23c1))
* **generator:** find the story by the id the file declares, and see a crash in a browser ([4f9c8da](https://github.com/southleft/story-ui/commit/4f9c8da9055bddd03b237bc6a0daf8de8eaf2b98))
* **generator:** judge exports by what they are, not what they are named ([1434ffa](https://github.com/southleft/story-ui/commit/1434ffad7048527401d2cfab954556afbcb12b85))
* **generator:** log a passing token check so it looks different from one that never ran ([b1b50d6](https://github.com/southleft/story-ui/commit/b1b50d6150258cc0bd49c02767965a4e6f235ac5))
* **generator:** make a check that did not run look different from one that found nothing ([d785789](https://github.com/southleft/story-ui/commit/d785789887f53835462179a00281b54c6e4ecf0a))
* **generator:** make image-driven generation actually use the image ([b041dde](https://github.com/southleft/story-ui/commit/b041ddeb4f6c7aa700529cbed232bda6c39328a5))
* **generator:** make time claims true, and bound the repair pass ([47a6dc7](https://github.com/southleft/story-ui/commit/47a6dc73ab7d7ceff80506ed0c653b401396612d))
* **generator:** never let a targeted edit silently rewrite the page ([d85e599](https://github.com/southleft/story-ui/commit/d85e599853c49c86566f192af0902b178977e318))
* **generator:** one story by default, and one reply instead of two ([4d73ea2](https://github.com/southleft/story-ui/commit/4d73ea20b8d941b6216e4ef3bad8f6101b043e0c))
* **generator:** probe aria-pressed toggles; strip the story prefix from update titles ([171a0b2](https://github.com/southleft/story-ui/commit/171a0b22aa06cbe02abd061fa599d017604b258f))
* **generator:** prop knowledge is cached per package, not per subpath ([01719d2](https://github.com/southleft/story-ui/commit/01719d2e0e412e71e64e1aab6708c20f2500e95e))
* **generator:** React's own warnings become findings; targeting skips story-local helpers; no blind MCP probe ([56956f2](https://github.com/southleft/story-ui/commit/56956f2054be3e9da6bd458dd2e8d4e3664597bb))
* **generator:** read components a package re-exports from a default ([1c7ddac](https://github.com/southleft/story-ui/commit/1c7ddac0b29ed95845443e2b6ea1fd7a22f94646))
* **generator:** read props declared as type aliases, and trim component names ([976bdd7](https://github.com/southleft/story-ui/commit/976bdd73fd9ad1eafd4cfc10de2422c7d0ad778a))
* **generator:** read the stylesheets a package declares, not six guessed names ([d413bf1](https://github.com/southleft/story-ui/commit/d413bf12da666c028260ec7834e07c100479f67b))
* **generator:** reject a named import the module does not actually export ([bdeae81](https://github.com/southleft/story-ui/commit/bdeae81d1243add9cdcf0bbae7f6ebd7fe91b176))
* **generator:** reject importing from an npm scope, which is not a package ([733ebb9](https://github.com/southleft/story-ui/commit/733ebb9d60088e052447f2dc871331356ede222c))
* **generator:** reject imports from packages that do not exist, and mark default exports ([e1cc0af](https://github.com/southleft/story-ui/commit/e1cc0af9e8652375807e94e2c55726546f5bc49a))
* **generator:** reject injected <style> elements and !important ([27ccf6d](https://github.com/southleft/story-ui/commit/27ccf6d8f944bc772c2735bd48945a20853d7082))
* **generator:** repair scope-root imports from discovery instead of asking again ([b39be4a](https://github.com/southleft/story-ui/commit/b39be4a90bb364c4cb3e8b7f1659226fe0b71548))
* **generator:** repair with edit blocks instead of rewriting the story ([118ab74](https://github.com/southleft/story-ui/commit/118ab74d52ff04a3166d08608cf72051198827c8))
* **generator:** resolve a click against what the file declares, and refuse ambiguity ([8f40039](https://github.com/southleft/story-ui/commit/8f40039df523732572786d8d16f91e2f1ae46cc0))
* **generator:** resolve imports from what the project declares, not from convention ([b2a27ef](https://github.com/southleft/story-ui/commit/b2a27ef01b45e9908f10e393d9f0287225ffeb2b))
* **generator:** resolve stories by title when storybook ignores the filename slug ([9065099](https://github.com/southleft/story-ui/commit/90650993b580a50637ef4d2000e08a15bc7365d3))
* **generator:** say React-only where it is, instead of failing like a bug ([5a89f38](https://github.com/southleft/story-ui/commit/5a89f38ecd4bfd9fb47279a3c1425b25b620e55e))
* **generator:** serve local-source knowledge to the property panel ([c8d8180](https://github.com/southleft/story-ui/commit/c8d8180d516367499f0492dc789bd81b242d0384))
* **generator:** stop a failed generation from taking down the Storybook ([e3981b0](https://github.com/southleft/story-ui/commit/e3981b01a8e9c35ea9dc9680945d5cc002b7592c))
* **generator:** stop demanding an import from a bare scope ([2967a53](https://github.com/southleft/story-ui/commit/2967a536a58a9dcfe78f5819bb1a15acbac8d5eb))
* **generator:** stop discarding every Storybook manifest example ([5ed1b4f](https://github.com/southleft/story-ui/commit/5ed1b4f8fb358fbb4af52aa854d85fe98a16a225))
* **generator:** stop post-processing inventing package names for correct imports ([884bf45](https://github.com/southleft/story-ui/commit/884bf45b9a231afe6d1a01bec144d22d50989b17))
* **generator:** stop probing selected radios, stop copying colours from reference images ([46a55ca](https://github.com/southleft/story-ui/commit/46a55cadb5938e199264a60b636db4bf478ec679))
* **generator:** stop reporting accessibility blockers for correct code ([c1926ab](https://github.com/southleft/story-ui/commit/c1926ab7caa56047a1313b58abf572b43bd607d8))
* **generator:** stop the bench silently skipping default-export components ([27793af](https://github.com/southleft/story-ui/commit/27793af63e6c2463e2e1ba80c794af890913c8f5))
* **generator:** stop the catalog teaching the model to write type annotations in JSX ([ac43954](https://github.com/southleft/story-ui/commit/ac43954bad5b357647ef1b84657d5d1b187e66d7))
* **generator:** stop the selection bench being blind to default imports ([88117d7](https://github.com/southleft/story-ui/commit/88117d77b73624f1bd0519d2ec5e4c4d49ac10f1))
* **generator:** stop the selection bench failing correct work ([c89f67c](https://github.com/southleft/story-ui/commit/c89f67c98e27730422c93269055ea7ab7c231933))
* **generator:** stop the validator rejecting components the catalog offers ([a9942a1](https://github.com/southleft/story-ui/commit/a9942a142f609056b0b8cbb9150fa0587a0cbf6b))
* **generator:** stop validator false positives from hard-failing generations ([7b19350](https://github.com/southleft/story-ui/commit/7b19350372b524572b67ce2d72b1c23080b2c9ff))
* **generator:** stop verification failing correct work on three more fronts ([8755e17](https://github.com/southleft/story-ui/commit/8755e1743927ae562bb8113fa47f6264568d8690))
* **generator:** suggest a replacement token from the same category ([0aaaf9e](https://github.com/southleft/story-ui/commit/0aaaf9e7e3af0726ed040b39209e09700ddeb700))
* **generator:** text attachments read as text; Stop aborts the model call; a refusal is not a story ([2bd2949](https://github.com/southleft/story-ui/commit/2bd2949459fe99ef8219593e3c0c371b3c3c7382))
* **generator:** three false blockers from the cross-library bench ([9740781](https://github.com/southleft/story-ui/commit/9740781aee2beaa7b8005acab98ebd649022362c))
* **mcp:** a story's render function counts as the owner the inspector narrows by ([c3b5dae](https://github.com/southleft/story-ui/commit/c3b5daea96205e2f0bfcab5395654511061bf114))
* **mcp:** confine story writes, require a token off loopback, and stop init deleting user files ([9df37ac](https://github.com/southleft/story-ui/commit/9df37ac2faf8a2f16d929be5cacd863284ad192b))
* **mcp:** demote generic wrappers among authored candidates too ([44627b2](https://github.com/southleft/story-ui/commit/44627b2dea9863ba66002ef2d814b882014311b5))
* **mcp:** do not write the voice-canvas story into a project without react-live ([ddfc83e](https://github.com/southleft/story-ui/commit/ddfc83e07f98cdfbbe87ac20878873ab746501e4))
* **mcp:** follow a story's render into the local component it renders ([ce7b95b](https://github.com/southleft/story-ui/commit/ce7b95bc3eddc89bbb6bd7e1db88b6d0e1d0844a))
* **mcp:** frame reference images as references, and name conformance failures as such ([82704c7](https://github.com/southleft/story-ui/commit/82704c7163a9e2e1c4bd40dbdffb7382059c7661))
* **mcp:** hand off the stylesheet too, and stop claiming a recovery we never built ([f031335](https://github.com/southleft/story-ui/commit/f03133552fbd8840784c40cc27a68db8388db3e9))
* **mcp:** handoff on a real install, and verify what portals render ([c95a699](https://github.com/southleft/story-ui/commit/c95a699fac33a85e3010070d9e17cb2f77f2e8ab))
* **mcp:** routes forward files and selection; provider choice persists; 501 reason shown ([bd98222](https://github.com/southleft/story-ui/commit/bd98222648cf365205fd1623cfef8ecb6e2bb45d))
* **mcp:** the Components drawer counts props from the library's declarations ([b2b131d](https://github.com/southleft/story-ui/commit/b2b131d4ae54a7f252333bbe6d5d47981a233b14))
* **ui:** classic-panel updates keep their story id; image turns get a real budget; reopened chats keep their story ([7f8137e](https://github.com/southleft/story-ui/commit/7f8137e79c2342c08d3c0befed998f8da233d0f0))
* **ui:** hand off says what happens to the rest of your uncommitted changes ([8c8e9b0](https://github.com/southleft/story-ui/commit/8c8e9b00be90ff362ce62ddb79a3a683613fd6c9))
* **ui:** keep attribute order when the property panel replaces a prop ([b5386f8](https://github.com/southleft/story-ui/commit/b5386f8242239279074b3d567659cec41d652d56))
* **ui:** keep the active story across the remount a new story causes ([4137a77](https://github.com/southleft/story-ui/commit/4137a77aaffba0b2a2dba9e79221237b32d06d6d))
* **ui:** make generated stories reachable and keep reference images ([35da259](https://github.com/southleft/story-ui/commit/35da259efe89f38e0d28dc1f909030cf49c3771e))
* **ui:** match the final step's wording to the badge ([f01da35](https://github.com/southleft/story-ui/commit/f01da351a717ba5699fa405bbaf951e8925cdaea))
* **ui:** name components the way each design system does, not the way Mantine does ([65cde29](https://github.com/southleft/story-ui/commit/65cde2914be5dd1ffca104439981be5e8934f728))
* **ui:** persist completion payload so recovered chats keep code, timing, and suggestions ([c902eee](https://github.com/southleft/story-ui/commit/c902eeedc29918ad9c1004b6d07c9ef3f9587971))
* **ui:** render backticked component names in the narration as code ([4fc0a44](https://github.com/southleft/story-ui/commit/4fc0a443c808dad34f246976671bdebecf8710c7))
* **ui:** resolve the clicked element against the source, not the fiber alone ([0fbabc6](https://github.com/southleft/story-ui/commit/0fbabc6e7245b6a70d0716fe697a02f7eaf22cdf))
* **ui:** resolved component names, recovered badges, and honest restore notes ([fb3a5b5](https://github.com/southleft/story-ui/commit/fb3a5b55f0a5e837ab310d44183e19280e4a8a46))
* **ui:** send measured targeting facts, not a guessed chain order ([7a5e2f6](https://github.com/southleft/story-ui/commit/7a5e2f6800b9ee0cc29804502292107f3413546e))
* **ui:** stop editing the wrong element inside a list, and stop the catalog inviting invention ([95ec245](https://github.com/southleft/story-ui/commit/95ec245985ee15096664d01834dc0f5fd0dff380))
* **ui:** stop reporting work that did not happen, and make Stop stop ([dcffb5f](https://github.com/southleft/story-ui/commit/dcffb5fa8394833f0196e4ce0a30b79010750913))
* **ui:** target by ownership facts, and wait while the server works ([185b12c](https://github.com/southleft/story-ui/commit/185b12c66c6bc8c381d648386ed6606f81a9dcd7))
* **ui:** the classic panel probes for the Storybook MCP addon only when the preference was set explicitly ([1d7efa3](https://github.com/southleft/story-ui/commit/1d7efa3893601ecd77cf7682cb401e93eebd8b10))
* **ui:** the classic panel verifies against its own Storybook; non-React findings and copy are honest ([5a913c0](https://github.com/southleft/story-ui/commit/5a913c07e5744ec8ea5cf65e03c094cb107bece2))
* **ui:** the home subtitle names a local library as the project's own components ([f7310a3](https://github.com/southleft/story-ui/commit/f7310a3f443bfbe00bf6401a14da4ed9a96b10fc))
* **ui:** the manifest records that a story did not render, so any browser shows it ([db61445](https://github.com/southleft/story-ui/commit/db61445386ea219ea8fcf76d41a4ec044a7904bd))
* **ui:** v2 workspace defects found by driving it with playwright ([4ce4e43](https://github.com/southleft/story-ui/commit/4ce4e43b581c8b30ac045aa7ae8355803631fa5f))
* **ui:** workspace is positioned over the manager's content cell, not the page wrapper ([e91293a](https://github.com/southleft/story-ui/commit/e91293a096fa762861718d0d135f2eabe6a8ba82))


### Features

* **ci:** bench/smoke.mjs — the workspace flow matrix against any Storybook ([57ba804](https://github.com/southleft/story-ui/commit/57ba80486dcc814aff8ef54a9c2a6dec960f793c))
* **ci:** fidelity bench — right components, right states, minimal edits, logged ([71b7301](https://github.com/southleft/story-ui/commit/71b73012f7c2691ca55a4fbcb4173bfdb431d6a9))
* **ci:** library-agnostic fidelity scoring and a cross-library durability bench ([e5d3677](https://github.com/southleft/story-ui/commit/e5d3677fb15d4e780f4b9c607776755d4c71e510))
* **cli:** check reports whether Playwright's browser build is installed ([dc70dca](https://github.com/southleft/story-ui/commit/dc70dca40147dc60d27b23226b07518aa5b1cdaa))
* **cli:** deliver the v2 workspace on update, and unbreak non-react installs ([0e4becf](https://github.com/southleft/story-ui/commit/0e4becffadb5e2b207aba2258814f14f6cdb4f75))
* **cli:** generate the Storybook preview from the derived host contract ([20725f7](https://github.com/southleft/story-ui/commit/20725f74096ecb8895bf8c0dced2f047798074dc))
* **cli:** init that never hangs, a check command, and detection that finds the npm design system ([a516d0d](https://github.com/southleft/story-ui/commit/a516d0d77b94bc5b5032b95e7ba1852f6f0d28b3))
* **cli:** install the V2 workspace during init ([47b11ca](https://github.com/southleft/story-ui/commit/47b11ca399486845b19a46880de93f832257fe95))
* **config:** excludeComponents, so a project can drop what discovery found ([54e44e7](https://github.com/southleft/story-ui/commit/54e44e7dcc2713ddfcd68751b14a11446b94906c))
* **generator:** an iteration can no longer silently destroy previous work ([d124527](https://github.com/southleft/story-ui/commit/d12452718bd591767a156fcac2d41eba7617b11e))
* **generator:** catch class names nothing defines, and drop a corrupting sentinel ([b04c441](https://github.com/southleft/story-ui/commit/b04c441fab04a8a38f82116a9ec071736de88cd3))
* **generator:** change a prop without asking a model ([33631d3](https://github.com/southleft/story-ui/commit/33631d3a380cd9581995da8fb1abe572cb99b910)), closes [#ff0000](https://github.com/southleft/story-ui/issues/ff0000)
* **generator:** check the layout arithmetic, not just the accessibility ([c9d47f7](https://github.com/southleft/story-ui/commit/c9d47f7ec907a8676eb27e8011b91b5fc56a49fb))
* **generator:** check the output against the facts we supplied ([e662bcf](https://github.com/southleft/story-ui/commit/e662bcf645004105442425dcbe232704422fbdad))
* **generator:** compose with the project's own tokens and styling idiom ([0c9c2e7](https://github.com/southleft/story-ui/commit/0c9c2e7c414c4e906f514ad4804615e01aa39571))
* **generator:** current models, edit blocks for updates, and a streamed plan ([be593ce](https://github.com/southleft/story-ui/commit/be593cedf9f20fa2e2d95f79dd0240dbac0beab7))
* **generator:** derive what a design system needs around it ([797a9df](https://github.com/southleft/story-ui/commit/797a9dffeed7350dc2f05b97b483c4639a07f76b))
* **generator:** emit a stylesheet alongside the story when states need one ([a1c9486](https://github.com/southleft/story-ui/commit/a1c9486ba3c9bf77dd9384b1f341689627b138aa))
* **generator:** extract real component APIs from the installed type declarations ([6bc44d1](https://github.com/southleft/story-ui/commit/6bc44d1d94aa6579df75c267d98db9e59f62c8c1))
* **generator:** find a component's props where it declares them, not where the name suggests ([cc50f89](https://github.com/southleft/story-ui/commit/cc50f896182db321f309482c973ad6cb4d44f9ee))
* **generator:** follow a barrel's re-exports into sibling packages ([19c0398](https://github.com/southleft/story-ui/commit/19c03986583f1be7cf4c156b35fb3abc0967490d))
* **generator:** interaction fidelity contract and catalog quality ([dd29990](https://github.com/southleft/story-ui/commit/dd29990e33848a81cf5ce96ac3ea38da76fd540e))
* **generator:** judge components by declaration, key caches on content, and make the bench honest ([6209c72](https://github.com/southleft/story-ui/commit/6209c723110657ee1123597bcd76daefed169f66))
* **generator:** judge the rendered result against the request, with eyes ([cc536e3](https://github.com/southleft/story-ui/commit/cc536e393e855ea015340e2e3654fc98966849b8))
* **generator:** learn compound components by reflecting on the installed package ([afa5ab2](https://github.com/southleft/story-ui/commit/afa5ab2fee3b541769d38350b6eaa3229f5a599e))
* **generator:** make monorepo workspace design systems visible ([df0bd11](https://github.com/southleft/story-ui/commit/df0bd110227863e6248da1d9d367561d3efb1b7c))
* **generator:** make verification repair actually work, and turn it on ([775d2b8](https://github.com/southleft/story-ui/commit/775d2b8e82ede18dee0e4d3f868c503d9d7f138d))
* **generator:** narrate runtime healing and verification repair live ([e5dbc4b](https://github.com/southleft/story-ui/commit/e5dbc4bcab0da60f5b0a7545f155b5ea86148f26))
* **generator:** read a local component's props and prose from its own source ([7b09309](https://github.com/southleft/story-ui/commit/7b0930983cce804da16d74904b3f8368f0e86532))
* **generator:** read attached files, and reject design tokens the project never declared ([9ccd4c8](https://github.com/southleft/story-ui/commit/9ccd4c8e3a7f8243292ae3b5d3818d0310284cb8))
* **generator:** read design tokens the system ships, not only the ones the project writes ([a45ed6d](https://github.com/southleft/story-ui/commit/a45ed6d700687214b2232dab9eac50102d416622))
* **generator:** read what a design system says about its own props ([5090f39](https://github.com/southleft/story-ui/commit/5090f394ed5d2047e4ea224b09229bfc83c43b46))
* **generator:** read what a local design system says about itself ([bfb602c](https://github.com/southleft/story-ui/commit/bfb602c89b528549921a968670ceef2b8aedcc5f))
* **generator:** repair what verification observed, behind a guarded enforce mode ([ec3dbf9](https://github.com/southleft/story-ui/commit/ec3dbf9872a6f825f4659605f4a81ef9f7e995b2))
* **generator:** resolve props inherited through an extends chain ([b9860bb](https://github.com/southleft/story-ui/commit/b9860bb87134fb5617eb761bf9dbd6c173e4fa9e))
* **generator:** run axe against every generated story ([5f29da8](https://github.com/southleft/story-ui/commit/5f29da847201563e17d564184806a5960c2b2cd9))
* **generator:** see namespace exports, and every CJS library's components ([19ba01d](https://github.com/southleft/story-ui/commit/19ba01df2894676c8f8191c157869006ed864c56))
* **generator:** stream the model call, cache the prompt prefix, and fix updates without history ([05d9d98](https://github.com/southleft/story-ui/commit/05d9d98c7d2386cee7e1ede2d8ee144b4ab9dc2b))
* **generator:** support complex compositions, and stop the probe lying about them ([8c4050a](https://github.com/southleft/story-ui/commit/8c4050ada46d98e8dad15853e75cf1e5b5a78c30))
* **generator:** support design systems that ship one package per component ([28ceae6](https://github.com/southleft/story-ui/commit/28ceae660d0376e7f765452921fbbb73100fa598))
* **generator:** support the federated namespace barrel (radix-ui) ([b0245ec](https://github.com/southleft/story-ui/commit/b0245ecd5930394aa12e72c27cebc6c8aadc9ac4))
* **generator:** teach the model this project's design system from its own Storybook ([553b760](https://github.com/southleft/story-ui/commit/553b760d7da124b8a4601f4bcbb206943f8c35de))
* **generator:** tell the model how many columns the grid actually has ([5428de0](https://github.com/southleft/story-ui/commit/5428de02c312507bb8c1cb566c4151acec32e259))
* **generator:** verify by USING the page, not only looking at it ([fd8c9e3](https://github.com/southleft/story-ui/commit/fd8c9e3774debfabedd698c68cbcd0870e71ff97))
* **generator:** verify generated stories in a real browser ([b00f83f](https://github.com/southleft/story-ui/commit/b00f83fef4a97deb1005bc3b68a82323047a21b5))
* **mcp:** show the preview at write time, pin hand-set props, and guard background writes ([7ee60a0](https://github.com/southleft/story-ui/commit/7ee60a0e19961bbec3996840f3dd8a2d756cf8a0))
* **mcp:** stream the code as it is written, carry applied edits, ground follow-ups in findings ([8178500](https://github.com/southleft/story-ui/commit/81785006938f32012b3bde9b10ea8b19e64ed817))
* **ui:** a property panel for changes that have one right answer ([61f92ea](https://github.com/southleft/story-ui/commit/61f92ea5e0ab5bbcfc85867a64915a6ae9dce252))
* **ui:** a story that does not render is never shown as the result ([d96d732](https://github.com/southleft/story-ui/commit/d96d73207b0c57eed65a1e056362ce8e63ffc457))
* **ui:** code view, honest failures, host theme, onboarding, and a request-ranked catalog ([33887a6](https://github.com/southleft/story-ui/commit/33887a6ed5287fe1f559a5aac16772451b60d36c))
* **ui:** design context authoring surface ([3ba888b](https://github.com/southleft/story-ui/commit/3ba888b2e2ce4b321bbce6295f96be438de757a5))
* **ui:** host the workspace in Storybook's manager, where nothing remounts ([71b3a68](https://github.com/southleft/story-ui/commit/71b3a68813b9894f64fc6de6a33dad958dca87ef))
* **ui:** images, dictation, and reload recovery in the v2 workspace ([566fcd3](https://github.com/southleft/story-ui/commit/566fcd3e023a3b725894ee7e82fbc13d5460a6d8))
* **ui:** let the preview use the whole canvas ([ba5cc6f](https://github.com/southleft/story-ui/commit/ba5cc6f0ad382a5aa7b4dd273696e531dd8d4285))
* **ui:** live narration, focus mode, fullscreen, five images; streams bounded by silence ([e6f84d6](https://github.com/southleft/story-ui/commit/e6f84d678463e24bed4620dec68ddb22dc4f41dd))
* **ui:** point at an element and describe a change to it ([4edfac3](https://github.com/southleft/story-ui/commit/4edfac3adf9432a6a8b875d56a8554f569337041))
* **ui:** property editing moves into an inspector beside the preview ([28744e1](https://github.com/southleft/story-ui/commit/28744e1a7a7ed656defe5657199b60159515623c))
* **ui:** read component names from React, not from CSS class conventions ([fd1a457](https://github.com/southleft/story-ui/commit/fd1a457333e27b91fe9e3638993acbcaf7bb33a0))
* **ui:** rebuild the v2 workspace on radix themes ([15e4cfc](https://github.com/southleft/story-ui/commit/15e4cfc22a858e4d8dbd7de8e5702619aeb90f93))
* **ui:** restore an earlier version of a story ([25d4d8d](https://github.com/southleft/story-ui/commit/25d4d8d3b53696bc649d7c0f1d9bda0a34f13d9a))
* **ui:** restore conversations in v2 and edit stories in place ([ee77c46](https://github.com/southleft/story-ui/commit/ee77c46d14a49cf2ff96a978fc746975ae6a5044))
* **ui:** ship the workspace as a package export, not as copied source ([972c264](https://github.com/southleft/story-ui/commit/972c26460447e696edb665fdaae7046d86c31567))
* **ui:** show the late pipeline steps, and centre the canvas states ([0d69ef8](https://github.com/southleft/story-ui/commit/0d69ef8420ac5130e7e686bf698eac9eff9628bf))
* **ui:** story ui v2 workspace with conversation beside a live preview ([16cf9a0](https://github.com/southleft/story-ui/commit/16cf9a0a1d235a2f49df358d13fab85b353d6b4b)), closes [#14100](https://github.com/southleft/story-ui/issues/14100)
* **ui:** strip the workspace chrome down to what does something ([e5370a9](https://github.com/southleft/story-ui/commit/e5370a9cb1279bcf64ff782ab586b5138c02b3e1))
* **ui:** surface verification, and hand a finished story to a branch or PR ([65f3ad3](https://github.com/southleft/story-ui/commit/65f3ad39ad7b45c68cb7e543bfb2747c73062d7f))
* **ui:** the file grows on screen as it is written, and a change shows as a diff ([fc8ebd1](https://github.com/southleft/story-ui/commit/fc8ebd1949bc58cf51daac7597a576e55707ddea))
* **ui:** wire handoff into the v2 workspace ([a72f5c8](https://github.com/southleft/story-ui/commit/a72f5c8ee3db4213aef7a7662489e5a7fedc865e))


### BREAKING CHANGES

* Storybook 10 or newer is required. Storybook 9.1 did not
refresh its story index when a generated file was written, so stories
appeared only after a restart; `story-ui check` reports the version.

Claude-Session: https://claude.ai/code/session_01AjkYtHWQ2S4nj7M2cbTZZS
* the HTTP routes providers/configure, providers/validate,
providers/default, providers/model, providers/settings, providers/config,
the five frameworks/* routes, POST /mcp/claude, /mcp/canvas-ensure and
/story-ui/delete are removed (nothing shipped called them). The
ALLOWED_PROVIDERS, ALLOWED_MODELS and SINGLE_PROVIDER_MODE environment
variables and the defaultAuthor, layoutInstructions, examples and
sampleStory config keys are removed; they were never read. Generated
stories now export one story by default. Storybook 9 or newer is required
for the manager page.

Claude-Session: https://claude.ai/code/session_01AjkYtHWQ2S4nj7M2cbTZZS

# [4.17.0](https://github.com/southleft/story-ui/compare/v4.16.12...v4.17.0) (2026-07-03)


### Bug Fixes

* **cli:** resolve update targets against the detected panel directory ([91c508e](https://github.com/southleft/story-ui/commit/91c508e5368b32e5e94ea47ececa69b3ba90e991))
* **ui:** 14px minimum type floor across the panel ([bdff158](https://github.com/southleft/story-ui/commit/bdff15837a33b15a05099496d69f5d94bbb54a44))
* **ui:** chat-scale composer, balanced header controls, separated action rows ([3f90a54](https://github.com/southleft/story-ui/commit/3f90a5413b2298d3b0eab500c65edd81e912e7f9))
* **ui:** correct theme detection, contrast, focus indicators, and chat typography ([ba98e4e](https://github.com/southleft/story-ui/commit/ba98e4ebe8c5da791d5fb7ff361612264bbc4277))
* **ui:** unified type scale pinned against docs-page style bleed ([5a3973d](https://github.com/southleft/story-ui/commit/5a3973d6ab567b4a57c2053a2aeab0193b02ec7c))


### Features

* **generator:** first-class support for custom local component libraries ([f5737fa](https://github.com/southleft/story-ui/commit/f5737fa8994f58849a85aea8d0d738083a553add))
* **generator:** unified generation core with isolation and richer context ([d63beb4](https://github.com/southleft/story-ui/commit/d63beb4c5feb249427eda461a6139e02e74c38da))
* **generator:** update LLM providers to current models with retry and streaming ([609399a](https://github.com/southleft/story-ui/commit/609399a1b7a51f6c3d480e8415e822d4df3569e3))
* **ui:** "Edit in Story UI" toolbar button on generated stories ([ccf4006](https://github.com/southleft/story-ui/commit/ccf4006568c94d3d98ba56163855b842eab0a4d7))
* **ui:** conversational chat, Storybook-native design, no-reload flow ([dc426fb](https://github.com/southleft/story-ui/commit/dc426fb32513969aaa258821ca692e16286ef16e))
* **ui:** voice canvas provenance marker in the story list ([ffbbbbe](https://github.com/southleft/story-ui/commit/ffbbbbea3c2d43228670cd98b262852fd427952e))

## [4.16.12](https://github.com/southleft/story-ui/compare/v4.16.11...v4.16.12) (2026-05-07)


### Bug Fixes

* restore considerations endpoint and ensure react-live in consumers ([c2d1e48](https://github.com/southleft/story-ui/commit/c2d1e483767586da530b4c74857c9ffd07663f71))

## [4.16.11](https://github.com/southleft/story-ui/compare/v4.16.10...v4.16.11) (2026-03-20)


### Bug Fixes

* restore localStorage bridge for first-generation iframe delivery ([1516c73](https://github.com/southleft/story-ui/commit/1516c73f63cd2989c3638cca0ac2ad908508c5a4))

## [4.16.10](https://github.com/southleft/story-ui/compare/v4.16.9...v4.16.10) (2026-03-20)


### Bug Fixes

* set explicit foreground color on canvas container for dark mode ([30e9b0c](https://github.com/southleft/story-ui/commit/30e9b0c7d96685b67d3ac0a2b3174df439eb6486))

## [4.16.9](https://github.com/southleft/story-ui/compare/v4.16.8...v4.16.9) (2026-03-20)


### Bug Fixes

* eliminate stale localStorage causing errors on canvas reload ([9f62088](https://github.com/southleft/story-ui/commit/9f620882f31704dec22dcc7ec3ca1c5c6306481e))

## [4.16.8](https://github.com/southleft/story-ui/compare/v4.16.7...v4.16.8) (2026-03-20)


### Bug Fixes

* increase voice auto-submit delay to 3s and require minimum 3 words ([67562cb](https://github.com/southleft/story-ui/commit/67562cb84480d6aa237761f3fe3ca04db2c3f969))

## [4.16.7](https://github.com/southleft/story-ui/compare/v4.16.6...v4.16.7) (2026-03-20)


### Bug Fixes

* pause voice recognition during generation, resume after ([bd93ec6](https://github.com/southleft/story-ui/commit/bd93ec65bdf0c94e93cd5e75bbf059cf5ce042ce))

## [4.16.6](https://github.com/southleft/story-ui/compare/v4.16.5...v4.16.6) (2026-03-19)


### Bug Fixes

* saved canvas stories fail with React is not defined ([04374d1](https://github.com/southleft/story-ui/commit/04374d1605843811ae23dd8a7b444472cf9a34e9))

## [4.16.5](https://github.com/southleft/story-ui/compare/v4.16.4...v4.16.5) (2026-03-19)


### Bug Fixes

* use voice-canvas-internal tag to hide scratchpad from sidebar ([9cbc21d](https://github.com/southleft/story-ui/commit/9cbc21d3e8a8b9d8ba9ab4fc3498cf53bd7be83d))

## [4.16.4](https://github.com/southleft/story-ui/compare/v4.16.3...v4.16.4) (2026-03-19)


### Bug Fixes

* voice canvas starts clean, hide scratchpad from sidebar ([5455f29](https://github.com/southleft/story-ui/commit/5455f29ec1f2fdb6bcb5111bc87d9d1789f61e4a))

## [4.16.3](https://github.com/southleft/story-ui/compare/v4.16.2...v4.16.3) (2026-03-19)


### Bug Fixes

* only create voice-canvas story template for React projects ([4776f0f](https://github.com/southleft/story-ui/commit/4776f0fe3afa54b6ac33aa0a0bbadb234f92968f))

## [4.16.2](https://github.com/southleft/story-ui/compare/v4.16.1...v4.16.2) (2026-03-19)


### Bug Fixes

* resolve actual component exports instead of Vue directory names ([61054cb](https://github.com/southleft/story-ui/commit/61054cbb530431f3e2a5dcbcf6a7dfee1ecc35a3))

## [4.16.1](https://github.com/southleft/story-ui/compare/v4.16.0...v4.16.1) (2026-03-19)


### Bug Fixes

* show friendly model names in dropdown instead of API slugs ([a07f77d](https://github.com/southleft/story-ui/commit/a07f77d44dc988fd186d0471f95a0087aba74380))

# [4.16.0](https://github.com/southleft/story-ui/compare/v4.15.0...v4.16.0) (2026-03-19)


### Bug Fixes

* remove ~1,215 lines of dead canvas code ([3d3687c](https://github.com/southleft/story-ui/commit/3d3687cf5ab98f21a64d225cea3062cfeacca475))
* security hardening for voice canvas and Gemini API key exposure ([f7c328c](https://github.com/southleft/story-ui/commit/f7c328c8a3f122fcac90e12fa8b40fb7bd7a488b))
* update LLM models to latest versions (March 2026) ([c9fa30e](https://github.com/southleft/story-ui/commit/c9fa30e10261ef7de9366692c70e6a28345238e8))


### Features

* add test suite for canvas pure functions ([05b41b3](https://github.com/southleft/story-ui/commit/05b41b33a9d97eaa6c2ef6b4c13b60f9c2b46a7a))

# [4.15.0](https://github.com/southleft/story-ui/compare/v4.14.0...v4.15.0) (2026-03-15)


### Bug Fixes

* **ui:** add saveStory to startListening dependency array ([8dd8247](https://github.com/southleft/story-ui/commit/8dd82479b3e266bf39be81c3239e5594d298999f))


### Features

* **ui:** add voice save commands and auto-fix missing render() call ([0274d7c](https://github.com/southleft/story-ui/commit/0274d7c638e2602c1bb17fac16e345620a90e2ac))

# [4.14.0](https://github.com/southleft/story-ui/compare/v4.13.3...v4.14.0) (2026-03-15)


### Features

* **ui:** add New Canvas button and forwardRef clear handle ([33d214c](https://github.com/southleft/story-ui/commit/33d214ce485177129dca0de3ac41764323efe229))

## [4.13.3](https://github.com/southleft/story-ui/compare/v4.13.2...v4.13.3) (2026-03-13)


### Bug Fixes

* **generator:** update OpenAI and Gemini model IDs to current versions ([d37b8ae](https://github.com/southleft/story-ui/commit/d37b8aeb05fde3bbfc8f2b54bccf1789ef045eea))

## [4.13.2](https://github.com/southleft/story-ui/compare/v4.13.1...v4.13.2) (2026-03-13)


### Bug Fixes

* **generator:** update Claude model IDs to current versions ([5014087](https://github.com/southleft/story-ui/commit/5014087f27c00ba6874d5fef33fe5f4ed21fd7b6))

## [4.13.1](https://github.com/southleft/story-ui/compare/v4.13.0...v4.13.1) (2026-03-13)


### Bug Fixes

* **ui:** fix Voice Canvas stuck-in-thinking race condition and add last-prompt display ([42d3916](https://github.com/southleft/story-ui/commit/42d39168a43bcb56a91cdbd7302dee4530609e2a))

# [4.13.0](https://github.com/southleft/story-ui/compare/v4.12.1...v4.13.0) (2026-03-13)


### Bug Fixes

* **mcp:** escape backslashes in prop strings and fix JSDoc on upsert ([f89e459](https://github.com/southleft/story-ui/commit/f89e459ebfa6d6628cf38ebe2fadb934a601ccb1))
* **ui:** add text input fallback and no-speech feedback to Voice Canvas ([b53a6ef](https://github.com/southleft/story-ui/commit/b53a6ef9ec3d2e2c3d1c398df51accd2181a3659))
* **ui:** auto-detect working mic and suggest system default change in Voice Canvas ([6181936](https://github.com/southleft/story-ui/commit/6181936f368093c0f1a7698a07fc1a19cd74bdae))
* **ui:** auto-title canvas saves from last voice prompt, remove save dialog ([7e268eb](https://github.com/southleft/story-ui/commit/7e268ebeffac364835c42371fdc984004802eb09))
* **ui:** clear canvas after save so scratchpad and saved story are distinct ([cfc0ade](https://github.com/southleft/story-ui/commit/cfc0ade8afc85051743fc382322383d3a4efffc9))
* **ui:** detect silent mic device and show actionable warning in Voice Canvas ([7f49319](https://github.com/southleft/story-ui/commit/7f49319807aa827b20a7528deac64e95b7939c1d))
* **ui:** fix Voice Canvas SSE parsing and generate-while-speaking ([474ecef](https://github.com/southleft/story-ui/commit/474ecefeb04e06b2f719e678a1ccbb24e4f921f5))
* **ui:** handle no-history stories correctly when selected from chat list ([d39375e](https://github.com/southleft/story-ui/commit/d39375e627bae6da3e07aebb54fc2a9adeddeed1))
* **ui:** persist Voice Canvas state across Storybook reloads ([eab88cf](https://github.com/southleft/story-ui/commit/eab88cf68b0c37eb4b162d1210ee576d77569371))
* **ui:** prevent page reload from killing Voice Canvas on first use ([10f4273](https://github.com/southleft/story-ui/commit/10f4273703249624b5a95875b25fead05ad82d60))
* **ui:** remove text input from Voice Canvas; gate on Web Speech API ([8f975fa](https://github.com/southleft/story-ui/commit/8f975fa4c0162d3edd5c16c07c24e31b35499963))
* **ui:** sync story/chat titles, ordering, delete, and rename propagation ([68b4995](https://github.com/southleft/story-ui/commit/68b499511dfb2a87eb371e3868c7632e1a193e7a))
* **ui:** synthesize conversations from metadata.prompt for all generated stories ([256ffd3](https://github.com/southleft/story-ui/commit/256ffd3d5f9480f6c329476ee667313f5985e846))


### Features

* **mcp:** add manifest-based story/chat sync system ([47be809](https://github.com/southleft/story-ui/commit/47be8091ac9b2329e0f02d9383234516a90b952e))
* **mcp:** auto-install react-live on first Voice Canvas use ([95fde5a](https://github.com/southleft/story-ui/commit/95fde5a0b08313c3bfd01de68813e5f66ff8c909))
* **ui:** add deterministic style-to-token mapping for voice-to-story conversion ([7643944](https://github.com/southleft/story-ui/commit/7643944e42dec97de438c3224cf0a1b145ace2cd))
* **ui:** add section-tagged edits and dedicated story conversion endpoint ([6c22c43](https://github.com/southleft/story-ui/commit/6c22c4321acfaebaefd1eed616cde100d9f686d7))
* **ui:** add Voice Canvas mode for ephemeral voice-to-UI generation ([4f93e34](https://github.com/southleft/story-ui/commit/4f93e347321a08b88d43cbba9b11805ea315b981))
* **ui:** add voice-activated UI generation ([9b4a6fd](https://github.com/southleft/story-ui/commit/9b4a6fd534077acbed318f864603484dc9db4aac))
* **ui:** decouple Voice Canvas from Mantine, gate to React-only ([de2bdcd](https://github.com/southleft/story-ui/commit/de2bdcd40cdb7e0189c3aa10ba1f5a091efda9d4))
* **ui:** replace lightning badge with subtle border; seed voice story conversations ([ad6c595](https://github.com/southleft/story-ui/commit/ad6c5958eca3176a97b9aa798ee13c78dfc7bf8b))
* **ui:** rewrite Voice Canvas v5 with Storybook iframe + postMessage ([d3fb822](https://github.com/southleft/story-ui/commit/d3fb82200fc5a3d7b1753f2f5eaa5959a250796b))
* **ui:** sync chat list order with Storybook sidebar and surface MCP stories ([a733acf](https://github.com/southleft/story-ui/commit/a733acf794a2bd0b361e2538ac1e80e3b22a0c57))

# [4.13.0](https://github.com/southleft/story-ui/compare/v4.12.1...v4.13.0) (2026-03-13)


### Bug Fixes

* **mcp:** escape backslashes in prop strings and fix JSDoc on upsert ([f89e459](https://github.com/southleft/story-ui/commit/f89e459ebfa6d6628cf38ebe2fadb934a601ccb1))
* **ui:** add text input fallback and no-speech feedback to Voice Canvas ([b53a6ef](https://github.com/southleft/story-ui/commit/b53a6ef9ec3d2e2c3d1c398df51accd2181a3659))
* **ui:** auto-detect working mic and suggest system default change in Voice Canvas ([6181936](https://github.com/southleft/story-ui/commit/6181936f368093c0f1a7698a07fc1a19cd74bdae))
* **ui:** auto-title canvas saves from last voice prompt, remove save dialog ([7e268eb](https://github.com/southleft/story-ui/commit/7e268ebeffac364835c42371fdc984004802eb09))
* **ui:** clear canvas after save so scratchpad and saved story are distinct ([cfc0ade](https://github.com/southleft/story-ui/commit/cfc0ade8afc85051743fc382322383d3a4efffc9))
* **ui:** detect silent mic device and show actionable warning in Voice Canvas ([7f49319](https://github.com/southleft/story-ui/commit/7f49319807aa827b20a7528deac64e95b7939c1d))
* **ui:** fix Voice Canvas SSE parsing and generate-while-speaking ([474ecef](https://github.com/southleft/story-ui/commit/474ecefeb04e06b2f719e678a1ccbb24e4f921f5))
* **ui:** handle no-history stories correctly when selected from chat list ([d39375e](https://github.com/southleft/story-ui/commit/d39375e627bae6da3e07aebb54fc2a9adeddeed1))
* **ui:** persist Voice Canvas state across Storybook reloads ([eab88cf](https://github.com/southleft/story-ui/commit/eab88cf68b0c37eb4b162d1210ee576d77569371))
* **ui:** prevent page reload from killing Voice Canvas on first use ([10f4273](https://github.com/southleft/story-ui/commit/10f4273703249624b5a95875b25fead05ad82d60))
* **ui:** remove text input from Voice Canvas; gate on Web Speech API ([8f975fa](https://github.com/southleft/story-ui/commit/8f975fa4c0162d3edd5c16c07c24e31b35499963))
* **ui:** sync story/chat titles, ordering, delete, and rename propagation ([68b4995](https://github.com/southleft/story-ui/commit/68b499511dfb2a87eb371e3868c7632e1a193e7a))
* **ui:** synthesize conversations from metadata.prompt for all generated stories ([256ffd3](https://github.com/southleft/story-ui/commit/256ffd3d5f9480f6c329476ee667313f5985e846))


### Features

* **mcp:** add manifest-based story/chat sync system ([47be809](https://github.com/southleft/story-ui/commit/47be8091ac9b2329e0f02d9383234516a90b952e))
* **mcp:** auto-install react-live on first Voice Canvas use ([95fde5a](https://github.com/southleft/story-ui/commit/95fde5a0b08313c3bfd01de68813e5f66ff8c909))
* **ui:** add deterministic style-to-token mapping for voice-to-story conversion ([7643944](https://github.com/southleft/story-ui/commit/7643944e42dec97de438c3224cf0a1b145ace2cd))
* **ui:** add section-tagged edits and dedicated story conversion endpoint ([6c22c43](https://github.com/southleft/story-ui/commit/6c22c4321acfaebaefd1eed616cde100d9f686d7))
* **ui:** add Voice Canvas mode for ephemeral voice-to-UI generation ([4f93e34](https://github.com/southleft/story-ui/commit/4f93e347321a08b88d43cbba9b11805ea315b981))
* **ui:** add voice-activated UI generation ([9b4a6fd](https://github.com/southleft/story-ui/commit/9b4a6fd534077acbed318f864603484dc9db4aac))
* **ui:** decouple Voice Canvas from Mantine, gate to React-only ([de2bdcd](https://github.com/southleft/story-ui/commit/de2bdcd40cdb7e0189c3aa10ba1f5a091efda9d4))
* **ui:** replace lightning badge with subtle border; seed voice story conversations ([ad6c595](https://github.com/southleft/story-ui/commit/ad6c5958eca3176a97b9aa798ee13c78dfc7bf8b))
* **ui:** rewrite Voice Canvas v5 with Storybook iframe + postMessage ([d3fb822](https://github.com/southleft/story-ui/commit/d3fb82200fc5a3d7b1753f2f5eaa5959a250796b))
* **ui:** sync chat list order with Storybook sidebar and surface MCP stories ([a733acf](https://github.com/southleft/story-ui/commit/a733acf794a2bd0b361e2538ac1e80e3b22a0c57))

## [4.12.1](https://github.com/southleft/story-ui/compare/v4.12.0...v4.12.1) (2026-03-07)


### Bug Fixes

* security hardening, chat sync bugs, and code cleanup ([141e31d](https://github.com/southleft/story-ui/commit/141e31d44e8ae424187ac450adf530fb4e07c680))

# [4.12.0](https://github.com/southleft/story-ui/compare/v4.11.0...v4.12.0) (2026-01-13)


### Bug Fixes

* filter empty strings from import extraction to handle trailing commas ([d9ed689](https://github.com/southleft/story-ui/commit/d9ed6892ff32b750d5646d16c01e7a16e325536c))
* respect useStorybookMcp toggle in story generation ([ce71db3](https://github.com/southleft/story-ui/commit/ce71db3d944f8ad173c6de11c3f0db2af554c7eb))


### Features

* fetch component context from Storybook manifest endpoint ([d4695d8](https://github.com/southleft/story-ui/commit/d4695d8befa7eee9ab411ebee41f7390ea5d1ef2))

# [4.11.0](https://github.com/southleft/story-ui/compare/v4.10.0...v4.11.0) (2026-01-12)


### Features

* add Storybook MCP context toggle to Story UI panel ([e4d0532](https://github.com/southleft/story-ui/commit/e4d053289c217a020a2478da876dba7e6d3fc825))

# [4.10.0](https://github.com/southleft/story-ui/compare/v4.9.2...v4.10.0) (2026-01-11)


### Features

* **ui:** add auto-expanding textarea for multi-line prompts ([0a44b9f](https://github.com/southleft/story-ui/commit/0a44b9f891c4993de9f9d89bfa1c3146156f33b0))

## [4.9.2](https://github.com/southleft/story-ui/compare/v4.9.1...v4.9.2) (2026-01-11)


### Bug Fixes

* **cli:** remove StoryUI panel from gitignore patterns ([d2e1277](https://github.com/southleft/story-ui/commit/d2e1277e1667a25d20d38ece3708bf05f1ead7b4))

## [4.9.1](https://github.com/southleft/story-ui/compare/v4.9.0...v4.9.1) (2026-01-11)


### Bug Fixes

* **generator:** resolve relative paths against config file directory ([e3ecc21](https://github.com/southleft/story-ui/commit/e3ecc213fabd1c7c4ea8778c552be06fd8894d61))

# [4.9.0](https://github.com/southleft/story-ui/compare/v4.8.1...v4.9.0) (2026-01-11)


### Features

* add Storybook MCP integration for enhanced context fetching ([241e7c6](https://github.com/southleft/story-ui/commit/241e7c6aa43ec373750b1cae997077e5d3f31e9b))

## [4.8.1](https://github.com/southleft/story-ui/compare/v4.8.0...v4.8.1) (2026-01-08)


### Bug Fixes

* **generator:** improve slot handling and validation for Web Components ([5912420](https://github.com/southleft/story-ui/commit/5912420dab9455308a8e85ce26b6be7e777c3026))

# [4.8.0](https://github.com/southleft/story-ui/compare/v4.7.1...v4.8.0) (2026-01-06)


### Features

* rich prop type extraction and design-system agnostic barrel imports ([c4861c0](https://github.com/southleft/story-ui/commit/c4861c0f8b17b1ec3444205f2f0349a44670423f))

## [4.7.1](https://github.com/southleft/story-ui/compare/v4.7.0...v4.7.1) (2026-01-06)


### Bug Fixes

* **generator:** improve props extraction and response format ([939ebc5](https://github.com/southleft/story-ui/commit/939ebc52e10ccb28ec44aa4e272132062d5c7e0d))

# [4.7.0](https://github.com/southleft/story-ui/compare/v4.6.3...v4.7.0) (2026-01-06)


### Features

* **generator:** add framework-agnostic component extraction to adapters ([c15977a](https://github.com/southleft/story-ui/commit/c15977a2355171f9827b1f3466847c81597700e8))

## [4.6.3](https://github.com/southleft/story-ui/compare/v4.6.2...v4.6.3) (2026-01-05)


### Bug Fixes

* **generator:** improve vertical spacing and dark mode styling ([7529a68](https://github.com/southleft/story-ui/commit/7529a68d373f9c0be7f14e792975e0bd7b1b2089))

## [4.6.2](https://github.com/southleft/story-ui/compare/v4.6.1...v4.6.2) (2026-01-05)


### Bug Fixes

* **generator:** auto-detect icon packages and skip per-icon validation ([0d4c9ed](https://github.com/southleft/story-ui/commit/0d4c9ed210db5720a346956ccad436dd687e1a25))

## [4.6.1](https://github.com/southleft/story-ui/compare/v4.6.0...v4.6.1) (2025-12-19)


### Bug Fixes

* **deps:** resolve critical and high severity vulnerabilities ([6c21c00](https://github.com/southleft/story-ui/commit/6c21c007b8669440e94f4530e92aff69e1124572))

# [4.6.0](https://github.com/southleft/story-ui/compare/v4.5.2...v4.6.0) (2025-12-17)


### Bug Fixes

* **cli:** prevent memory exhaustion during vision processing ([aa5ef6c](https://github.com/southleft/story-ui/commit/aa5ef6cf4e7945f34004bd3ed2a95fdb0128ae89))
* **ui:** isolate StoryUI panel CSS from Storybook dark theme ([849f1e7](https://github.com/southleft/story-ui/commit/849f1e74326d6469d61253c033ba0fedd1b8ca9a))


### Features

* **generator:** add smart icon package detection for real icons ([546be1e](https://github.com/southleft/story-ui/commit/546be1e78b41142985c0a41f654c0f5c71ae4d8b))
* **generator:** improve self-healing with TypeScript validation and title versioning ([fb19790](https://github.com/southleft/story-ui/commit/fb197902a4a05ce37ea209706c75555bd4d73325))

## [4.5.2](https://github.com/southleft/story-ui/compare/v4.5.1...v4.5.2) (2025-12-16)


### Bug Fixes

* **generator:** smart icon handling based on design system capabilities ([44a2419](https://github.com/southleft/story-ui/commit/44a2419700766b90dd9bd7e6107e0f43c56350d2))

## [4.5.1](https://github.com/southleft/story-ui/compare/v4.5.0...v4.5.1) (2025-12-16)


### Bug Fixes

* **generator:** prohibit icon imports to prevent Gemini validation failures ([b581bd5](https://github.com/southleft/story-ui/commit/b581bd50b498dd0444a090c632dd1c5a846ef0d8))

# [4.5.0](https://github.com/southleft/story-ui/compare/v4.4.1...v4.5.0) (2025-12-15)


### Features

* **generator:** add Gemini 3 Pro Preview model ([d5eaf5a](https://github.com/southleft/story-ui/commit/d5eaf5a3deda345191feaf5fefb1da6026217984))

# [4.4.0](https://github.com/southleft/story-ui/compare/v4.3.0...v4.4.0) (2025-12-15)


### Features

* **ui:** add polling to detect MCP-generated stories and auto-refresh ([de6b1a1](https://github.com/southleft/story-ui/commit/de6b1a1e1b2a6f72b00f99f46e169f33089f393a))

# [4.3.0](https://github.com/southleft/story-ui/compare/v4.2.0...v4.3.0) (2025-12-15)


### Features

* **mcp:** add story management endpoints and production readiness fixes ([215e97c](https://github.com/southleft/story-ui/commit/215e97cf69faec0715096ae49453258afd4a88f3))

# [4.2.0](https://github.com/southleft/story-ui/compare/v4.1.1...v4.2.0) (2025-12-15)


### Bug Fixes

* **deps:** resolve merge conflicts and update LLM providers ([52ee58e](https://github.com/southleft/story-ui/commit/52ee58e37d5243faa0b13a2e322834713a9abde5))


### Features

* **ui:** add delete orphan stories functionality ([7b1cb51](https://github.com/southleft/story-ui/commit/7b1cb5137790f2111d16c3e890f6eeee48bf966d))

## [4.1.1](https://github.com/southleft/story-ui/compare/v4.1.0...v4.1.1) (2025-12-14)


### Bug Fixes

* **generator:** remove hash from story titles in Storybook navigation ([0472569](https://github.com/southleft/story-ui/commit/0472569386cad0955aa925a9de1038a80971bedb))

# [4.1.0](https://github.com/southleft/story-ui/compare/v4.0.1...v4.1.0) (2025-12-14)


### Features

* **ui:** persist provider preferences and hide hash from titles ([e40b450](https://github.com/southleft/story-ui/commit/e40b45067d25c6e9d183b8c3cdda331433b3cc9e))

## [4.0.1](https://github.com/southleft/story-ui/compare/v4.0.0...v4.0.1) (2025-12-14)


### Bug Fixes

* **generator:** respect provider/model selection from UI ([89fbebd](https://github.com/southleft/story-ui/commit/89fbebd2d6da522f313749f8ce74585da9b5df89))

# [4.0.0](https://github.com/southleft/story-ui/compare/v3.10.7...v4.0.0) (2025-12-14)


### Bug Fixes

* **cli:** add CSS file copy and auto-configure bundler for StoryUIPanel ([488ccef](https://github.com/southleft/story-ui/commit/488ccefbac5432fa6b5f7364d3685cc83eccdfe1))
* **cli:** detect Vite-based Storybook variants for Vue, Svelte, Web Components ([8ef6029](https://github.com/southleft/story-ui/commit/8ef602983d4903a0132c553eeb6a0e983e91d06c))
* **config:** add build step to prepare script for GitHub installs ([78bf77b](https://github.com/southleft/story-ui/commit/78bf77b940be439799378905f688f0dfa57bcf36))
* **config:** check for git dir before running husky in prepare script ([4bccf64](https://github.com/southleft/story-ui/commit/4bccf643660a6ad21eb5515a5f486135dfb99075))
* **config:** make prepare script resilient to missing git context ([afc1de1](https://github.com/southleft/story-ui/commit/afc1de1b553d46e4f6238b17147ca962a39efbb8))
* **generator:** add asChild prop to Svelte stories to prevent double-wrapping ([96f28d6](https://github.com/southleft/story-ui/commit/96f28d6260998a12ebda097d0b34737df9f08aa8))
* **generator:** add explicit guidance against deep import paths for Svelte ([409a154](https://github.com/southleft/story-ui/commit/409a154d93ad30755c8cc6a1661022659f425007))
* **generator:** add Svelte defineMeta title replacement to prevent duplicate story IDs ([3306480](https://github.com/southleft/story-ui/commit/33064805339d6c18984e09d9c90d590dc4d8341b))
* **generator:** handle Svelte CSF format in usable code detection and fallback ([c17f068](https://github.com/southleft/story-ui/commit/c17f0688e48b176f4ee1029abd2cd819226e92bf))
* **generator:** improve Svelte adapter regex to handle nested meta objects ([da96c79](https://github.com/southleft/story-ui/commit/da96c79b3c702c9aab91ffbdb0c8f2f8a6c02643))
* **generator:** make self-healing loop and validation framework-aware for Svelte ([9b42b4d](https://github.com/southleft/story-ui/commit/9b42b4d534ac74882869ae6481f25aee577cc683))
* **generator:** prevent double-nesting and update to Svelte 5 event syntax ([7f70930](https://github.com/southleft/story-ui/commit/7f709300cd73881f6327f343caa2387e23aceda9))
* **generator:** resolve 4 critical production bugs across frameworks ([daa97e8](https://github.com/southleft/story-ui/commit/daa97e864e7ba0673e2671d44ac7e06e3c36b0ca))
* **generator:** resolve Svelte code extraction and validation issues ([288cfb6](https://github.com/southleft/story-ui/commit/288cfb6d72e88ede19e8c4fd45dff0fec8c11fff))
* **generator:** return success:false when fallback error story is created ([299b535](https://github.com/southleft/story-ui/commit/299b5351c8769ad2561d0f4371e539bb4bd8edeb))
* **generator:** route Svelte code to Svelte validator in extractAndValidateCodeBlock ([26bdfb0](https://github.com/southleft/story-ui/commit/26bdfb0ce872cfc1468012fda9a9354869fbcbdd))
* **generator:** support addon-svelte-csf v5+ defineMeta syntax ([a2ed93e](https://github.com/southleft/story-ui/commit/a2ed93e839eaacfac04da31496ec8b1d20cc13ca))
* **generator:** update Svelte adapter for addon-svelte-csf v5+ defineMeta() syntax ([42e7ca8](https://github.com/southleft/story-ui/commit/42e7ca8f71005aa8c17159b291e00bdc5b337ecd))
* **mcp:** support fileName query param in delete endpoint ([bdcb422](https://github.com/southleft/story-ui/commit/bdcb422a9bd3a6d4ee330504fac7be92cf543ebc))
* security and ux improvements from llm audit ([faeb155](https://github.com/southleft/story-ui/commit/faeb155b28714da1417dc5da9c9905b972512982))
* sync package.json version with npm registry (3.10.9) ([c73f895](https://github.com/southleft/story-ui/commit/c73f895cd25d01ba73eb2e078c9216861c23a3a1))
* **ui:** preserve fileName during story iterations to prevent duplicates ([35f0345](https://github.com/southleft/story-ui/commit/35f0345f3418f8b34521604f4f332a14b2e39b84))
* **ui:** show 'Failed:' instead of 'Created:' when story generation fails ([a954626](https://github.com/southleft/story-ui/commit/a954626c379406602054481eb3cef4201aefcc1d))


### BREAKING CHANGES

* **generator:** for Svelte 5 / addon-svelte-csf v5.0.10+:
- Replace 'export const meta' with defineMeta() function
- Use '<script module>' instead of '<script context="module">'
- Destructure { Story } from defineMeta() return value
- Remove Template component (no longer needed in v5+)
- Add post-processing to convert old syntax to new
- Update validation to catch old CSF syntax patterns

This fixes the SB_SVELTE_CSF_PARSER_EXTRACT_SVELTE_0009 parser error
that occurs when using the old CSF export syntax with v5+ of the addon.

## [3.10.7](https://github.com/southleft/story-ui/compare/v3.10.6...v3.10.7) (2025-12-07)


### Bug Fixes

* **generator:** handle Svelte named imports with deep paths for flowbite-svelte ([438a89e](https://github.com/southleft/story-ui/commit/438a89ea2a28c8d6a112d362df6e9fa3a86581be))

## [3.10.6](https://github.com/southleft/story-ui/compare/v3.10.5...v3.10.6) (2025-12-07)


### Bug Fixes

* **generator:** prevent Angular TS4111 errors from state management patterns ([9df6f80](https://github.com/southleft/story-ui/commit/9df6f80f473a36789871baea8ecd3ffb4db86e97))

## [3.10.5](https://github.com/southleft/story-ui/compare/v3.10.4...v3.10.5) (2025-12-07)


### Bug Fixes

* **ui:** auto-refresh Storybook for new stories to fix Vite HMR import error ([aa1b976](https://github.com/southleft/story-ui/commit/aa1b976bcbbc424e0ab8714bd5abd5e454c36625))

## [3.10.4](https://github.com/southleft/story-ui/compare/v3.10.3...v3.10.4) (2025-12-07)


### Bug Fixes

* eliminate hardcoded React fallbacks for multi-framework support ([aa790ac](https://github.com/southleft/story-ui/commit/aa790ac4636628fcfc25e4112d8ba3d622e4eb2b))

## [3.10.3](https://github.com/southleft/story-ui/compare/v3.10.2...v3.10.3) (2025-12-07)


### Bug Fixes

* **generator:** resolve Svelte slot and Angular addon-actions errors ([6c84035](https://github.com/southleft/story-ui/commit/6c84035f8be76db5ebe5d8fa3509c1f20845d7f6))

## [3.10.2](https://github.com/southleft/story-ui/compare/v3.10.1...v3.10.2) (2025-12-07)


### Bug Fixes

* prevent Storybook duplicate ID errors with unique story titles ([7576998](https://github.com/southleft/story-ui/commit/7576998a94a89d88f79acc8a3770f819f3d8bdbb))

## [3.10.1](https://github.com/southleft/story-ui/compare/v3.10.0...v3.10.1) (2025-12-07)


### Bug Fixes

* detect custom domains as cloud deployments for MCP connection ([c76d049](https://github.com/southleft/story-ui/commit/c76d04984adfe0cc8bbbd42a7cd70bb521bfc98a))

# [3.10.0](https://github.com/southleft/story-ui/compare/v3.9.0...v3.10.0) (2025-12-06)


### Features

* redesign StoryUI panel with ShadCN-inspired chat interface ([d8bd165](https://github.com/southleft/story-ui/commit/d8bd1655f8d2759c0772634634404495a1fa0997))

# [3.9.0](https://github.com/southleft/story-ui/compare/v3.8.0...v3.9.0) (2025-12-04)


### Features

* add story management UI with bulk delete and clear all ([2177fa7](https://github.com/southleft/story-ui/commit/2177fa7e36803140bdd55452b143d145e975a33a))
* add story-ui update command for production deployments ([b1fff60](https://github.com/southleft/story-ui/commit/b1fff6065fe45a13a393d6e23bc2e4f90e44032e))

# [3.8.0](https://github.com/southleft/story-ui/compare/v3.7.0...v3.8.0) (2025-12-04)


### Features

* add runtime validation to catch Storybook runtime errors ([c32276b](https://github.com/southleft/story-ui/commit/c32276b796ae5800e39058dffabf48737430fdf5))

# [3.7.0](https://github.com/southleft/story-ui/compare/v3.6.2...v3.7.0) (2025-12-04)


### Bug Fixes

* add explicit framework prohibitions to prevent cross-framework component confusion ([c196e47](https://github.com/southleft/story-ui/commit/c196e471fa74a714a6d56cf9d09c3098a23e9f32))
* add framework-aware error suggestions for invalid import validation ([0f6386c](https://github.com/southleft/story-ui/commit/0f6386c2f812d5f76c1b3c3fa63c6fcabbfe198e))
* improve Vue/Vuetify story generation syntax ([f4d93b3](https://github.com/southleft/story-ui/commit/f4d93b30115d79ba8e75899eaa75a2d486ad8af6))
* make error suggestions design-system agnostic ([ac093df](https://github.com/southleft/story-ui/commit/ac093df37372df87c39752c51e613eadeb5f4b53))
* override Storybook CSS with !important for consistent styling ([5059957](https://github.com/southleft/story-ui/commit/5059957391678ec950922f8544a4d597a3fd87f8))


### Features

* add AI self-healing loop for story generation ([c607022](https://github.com/southleft/story-ui/commit/c6070224cf89a562348fa3fe47687f4c845934b6))
* add MDX wrapper for cross-framework StoryUIPanel rendering ([1c5b183](https://github.com/southleft/story-ui/commit/1c5b1834bdad948998d1bde8bf3087827335a143))
* remove custom Source Code addon in favor of native Storybook Docs ([2354352](https://github.com/southleft/story-ui/commit/23543527622fc57cec134593161f06653aaf4669))
* replace Unicode icons with SVGs, add human-readable model names ([e5433c3](https://github.com/southleft/story-ui/commit/e5433c3e96536add726b70646e5ca2d48738fa79))

## [3.6.2](https://github.com/southleft/story-ui/compare/v3.6.1...v3.6.2) (2025-12-02)


### Bug Fixes

* make Delete Story button more descriptive ([99d26ea](https://github.com/southleft/story-ui/commit/99d26ea0b5215dd77385ed92483c7f179ed30c66))

## [3.6.1](https://github.com/southleft/story-ui/compare/v3.6.0...v3.6.1) (2025-12-02)


### Bug Fixes

* show Delete button in empty state for generated stories ([e51c0d1](https://github.com/southleft/story-ui/commit/e51c0d123ea432c4dfc727d43ef2effcce268c08))

# [3.6.0](https://github.com/southleft/story-ui/compare/v3.5.1...v3.6.0) (2025-12-01)


### Features

* add delete button for generated stories in Source Code panel ([e0e6b4a](https://github.com/southleft/story-ui/commit/e0e6b4a79cfc39c9b0bf76ef571117d268394ce8))

## [3.5.1](https://github.com/southleft/story-ui/compare/v3.5.0...v3.5.1) (2025-12-01)


### Bug Fixes

* convert object-style props to proper JSX attribute syntax in Source Code panel ([7734fad](https://github.com/southleft/story-ui/commit/7734fad1b50927bc4875137b636f4bef7585bc8c))

# [3.5.0](https://github.com/southleft/story-ui/compare/v3.4.3...v3.5.0) (2025-12-01)


### Features

* add variant-specific usage code in Source Code panel ([db7d380](https://github.com/southleft/story-ui/commit/db7d38005a7b49e8ffb8cda9bf6c44193ac28596))

## [3.4.3](https://github.com/southleft/story-ui/compare/v3.4.2...v3.4.3) (2025-12-01)


### Bug Fixes

* use base64 data URL for attached image thumbnails in chat history ([c3ccdc4](https://github.com/southleft/story-ui/commit/c3ccdc4d7e77578bf2c4c3fed99856cd29c96bb5))

## [3.4.2](https://github.com/southleft/story-ui/compare/v3.4.1...v3.4.2) (2025-12-01)


### Bug Fixes

* add /story-ui/stories endpoint and fix API_BASE for Railway ([9aa124f](https://github.com/southleft/story-ui/commit/9aa124fb6570e1f4c1bb7c76ad8e51509e5f35b5))

## [3.4.1](https://github.com/southleft/story-ui/compare/v3.4.0...v3.4.1) (2025-12-01)


### Bug Fixes

* add explicit startCommand to railway.json for combined deployment ([ef9ffbf](https://github.com/southleft/story-ui/commit/ef9ffbf8796c69fa9fc7614cb97b7c4818f535d7))

# [3.4.0](https://github.com/southleft/story-ui/compare/v3.3.0...v3.4.0) (2025-12-01)


### Features

* add combined Storybook + MCP production deployment ([b34edd0](https://github.com/southleft/story-ui/commit/b34edd07c8485d9eaf24cc7bdaa13a3aa19577f0))

# [3.3.0](https://github.com/southleft/story-ui/compare/v3.2.0...v3.3.0) (2025-12-01)


### Features

* implement Streamable HTTP transport for Claude Desktop MCP ([73ce890](https://github.com/southleft/story-ui/commit/73ce89076e5e0ed761250cc6fa8c8de499004aa4))

# [3.2.0](https://github.com/southleft/story-ui/compare/v3.1.0...v3.2.0) (2025-12-01)


### Features

* add PostgreSQL persistence and remove Cloudflare Edge deployment ([34de0a6](https://github.com/southleft/story-ui/commit/34de0a63c66b8755d2e2260edc75347178ec9f3f))

# [3.1.0](https://github.com/southleft/story-ui/compare/v3.0.0...v3.1.0) (2025-12-01)


### Features

* add usage code extraction to Source Code panel ([312f7d8](https://github.com/southleft/story-ui/commit/312f7d8d5ad2290773078c9d14b4f4fdbfcb0230))

## [2.8.1](https://github.com/southleft/story-ui/compare/v2.8.0...v2.8.1) (2025-12-01)


### Bug Fixes

* auto-navigate to new story after generation to prevent HMR error ([77c1076](https://github.com/southleft/story-ui/commit/77c1076f8f0ff17d00b47ee1f3165ce2c054ceb0))

# [2.8.0](https://github.com/southleft/story-ui/compare/v2.7.0...v2.8.0) (2025-12-01)


### Features

* v3 cleanup - remove deprecated code and update documentation ([e56e5fb](https://github.com/southleft/story-ui/commit/e56e5fb7338bf7a56bfd28386ee72d1376f570f9))

# [2.7.0](https://github.com/southleft/story-ui/compare/v2.6.1...v2.7.0) (2025-11-30)


### Features

* add CLI --llm-provider option and improve component discovery ([dccf848](https://github.com/southleft/story-ui/commit/dccf848130dec53bc103f426120aaca05bb363bb))

## [2.6.1](https://github.com/southleft/story-ui/compare/v2.6.0...v2.6.1) (2025-11-30)


### Bug Fixes

* update model names and simplify design system options ([bfe9c04](https://github.com/southleft/story-ui/commit/bfe9c047ffb00df9691f0bd16a4aeed19f95d9dc))

# [2.6.0](https://github.com/southleft/story-ui/compare/v2.5.0...v2.6.0) (2025-11-30)


### Features

* add framework-agnostic updates for Story UI v3 ([f7d0b85](https://github.com/southleft/story-ui/commit/f7d0b85e3345aef881a229f636ba9c78ddbd19bb))

# [2.5.0](https://github.com/southleft/story-ui/compare/v2.4.0...v2.5.0) (2025-11-30)


### Features

* add Prism.js syntax highlighting and design-agnostic pop-out preview ([db15f9a](https://github.com/southleft/story-ui/commit/db15f9a43d836a5fe9a2de5910e8dff42f307fca))

# [2.4.0](https://github.com/southleft/story-ui/compare/v2.3.2...v2.4.0) (2025-11-30)


### Features

* update model selection to latest versions with friendly names ([cac5a4c](https://github.com/southleft/story-ui/commit/cac5a4ca127225d40947e6b689f96d08c04adf7a))

## [2.3.2](https://github.com/southleft/story-ui/compare/v2.3.1...v2.3.2) (2025-11-30)


### Bug Fixes

* allow user requests to override design system defaults in iterations ([75b9efa](https://github.com/southleft/story-ui/commit/75b9efa1b6f3800e0839469a1e4999709c2174c8))

## [2.3.1](https://github.com/southleft/story-ui/compare/v2.3.0...v2.3.1) (2025-11-29)


### Bug Fixes

* resolve useLocalStorage stale closure bug preventing chat history display ([184c436](https://github.com/southleft/story-ui/commit/184c43620b8988f381225dcfa5b88bc8b4a625d6))

# [2.3.0](https://github.com/southleft/story-ui/compare/v2.2.0...v2.3.0) (2025-11-29)


### Bug Fixes

* add considerations endpoint for Railway deployment ([dd316af](https://github.com/southleft/story-ui/commit/dd316af384b7ebfb853fba6322ce1baed39d3049))
* add post-generation validation gate and fix children prop stripping ([afb1918](https://github.com/southleft/story-ui/commit/afb191890eaf0713b45a64547a36d0a389368b23)), closes [#4](https://github.com/southleft/story-ui/issues/4) [#5](https://github.com/southleft/story-ui/issues/5)
* await async loadDocumentation call in considerations endpoint ([6a9b46a](https://github.com/southleft/story-ui/commit/6a9b46a3c7505bb0e8ed255c0edb1bd0c4dcefd1))
* extract system messages and pass as systemPrompt option ([33feb95](https://github.com/southleft/story-ui/commit/33feb95ad390d2262af2a7ec503059f9f95b791e))
* prevent LLM hallucination of wrong component libraries ([03d8254](https://github.com/southleft/story-ui/commit/03d8254e2c0a5ebb51cdbd1cc00b20c5cf1b9f74))
* remove organization-specific values for general-purpose use ([ba47a76](https://github.com/southleft/story-ui/commit/ba47a769e6e3387f9ece8d925ff055fd10306b5e))
* replace YOUR_ORG placeholders with actual organization names ([99ff48c](https://github.com/southleft/story-ui/commit/99ff48cddb3929806c10fc03f1ba032b499e167f))
* use fallback component list when npm package not installed ([057e9a4](https://github.com/southleft/story-ui/commit/057e9a40349c5fa46f33939f19f9547de39c5d56))


### Features

* add assistant prefill support for JSX output format ([8ff1a2b](https://github.com/southleft/story-ui/commit/8ff1a2b2095a5831d474b0c99ff7b682bffe7f3b))
* add Cloudflare Pages chat UI and unified deploy script ([e405aab](https://github.com/southleft/story-ui/commit/e405aabe2082812b32ab5fa4c655ba3f5130a867))
* add Cloudflare Workers edge deployment for MCP remote server ([a319671](https://github.com/southleft/story-ui/commit/a319671b0361fefb13be0ee1c5f1b877df158aa6))
* add environment parity for design system considerations ([8242b50](https://github.com/southleft/story-ui/commit/8242b502f572587368e869cb3bb48f593a781d38))
* add MCP remote HTTP transport for Claude Desktop connections ([37258e2](https://github.com/southleft/story-ui/commit/37258e22f8a29b79d40e54d149a5a3c6bd4ae1b9))
* add multi-provider LLM support and smart chat titles to Cloudflare edge ([e8215fc](https://github.com/southleft/story-ui/commit/e8215fce98ff94929e79265f85afe40aa4cfd15d))
* add multi-provider LLM support, framework adapters, and SSE streaming ([ed2b422](https://github.com/southleft/story-ui/commit/ed2b4221f063c94f36c836db032d2b149863bbe7))
* add production app template with universal best practices ([80252b7](https://github.com/southleft/story-ui/commit/80252b7c3249677ad0dfe0a6aa081bdfd36f1076))
* enhance chat responses with contextual component insights ([4e3c3a1](https://github.com/southleft/story-ui/commit/4e3c3a1c3e13482930d0d309d7bee574b65f66a6))

# [2.2.0](https://github.com/southleft/story-ui/compare/v2.1.5...v2.2.0) (2025-08-05)


### Bug Fixes

* implement direct file system reading for update-story operation ([df01bed](https://github.com/southleft/story-ui/commit/df01bed8116e8a6527407e1f4fc8f5345a520956))
* implement session management and direct file system operations for MCP server ([931b9ba](https://github.com/southleft/story-ui/commit/931b9baf8b790254074801a2c6286ac99c09a7c7))
* preserve story identity during updates to prevent URL changes ([dd830f4](https://github.com/southleft/story-ui/commit/dd830f4c0c3df250a9907ab7143a793756498c6d))
* resolve duplicate chat entries and Ant Design icon errors ([65fee01](https://github.com/southleft/story-ui/commit/65fee019f945e412657f518bcdb70632979c477b))


### Features

* add MCP (Model Context Protocol) integration for Story UI ([fb35f1d](https://github.com/southleft/story-ui/commit/fb35f1d6ba8248ac8fb4f24879ac8c89ad5759c3))
* add working MCP server integration with Claude Desktop ([ed359ee](https://github.com/southleft/story-ui/commit/ed359eeabe9d256d77515ab5b81cc84db0755cc7))
* implement URL redirect system for story updates ([4c8e54e](https://github.com/southleft/story-ui/commit/4c8e54e1186c92b9378137d5fa59d24ba4674125))

## [2.1.5](https://github.com/southleft/story-ui/compare/v2.1.4...v2.1.5) (2025-07-23)


### Bug Fixes

* handle story deletion with .stories.tsx extension in chat IDs ([5ee3dd0](https://github.com/southleft/story-ui/commit/5ee3dd0bc92d84b5a751226b2ee6f6fc9f798f28))

## [2.1.4](https://github.com/southleft/story-ui/compare/v2.1.3...v2.1.4) (2025-07-22)


### Bug Fixes

* improve design system installation flow with clearer messaging ([c520d13](https://github.com/southleft/story-ui/commit/c520d13f32499d59a89e2574ceb97ab014df365e))

## [2.1.3](https://github.com/southleft/story-ui/compare/v2.1.2...v2.1.3) (2025-07-22)


### Bug Fixes

* clean up broken preview.tsx files when dependencies are missing ([dd9e3d2](https://github.com/southleft/story-ui/commit/dd9e3d27951eeb47bad61a71b7217e844f244128))

## [2.1.2](https://github.com/southleft/story-ui/compare/v2.1.1...v2.1.2) (2025-07-22)


### Bug Fixes

* ensure design system packages are installed before creating preview files ([#7](https://github.com/southleft/story-ui/issues/7)) ([f701749](https://github.com/southleft/story-ui/commit/f7017497b70fef1d7ffb0cd89f37d98e9ad0e63e))

## [2.1.1](https://github.com/southleft/story-ui/compare/v2.1.0...v2.1.1) (2025-07-22)


### Bug Fixes

* remove duplicate setupStorybookPreview function definition ([167e699](https://github.com/southleft/story-ui/commit/167e699a308e861230ae67879d7900d7b6020dc0))

# [2.1.0](https://github.com/southleft/story-ui/compare/v2.0.1...v2.1.0) (2025-07-22)


### Features

* add guided design system installation and auto-configuration ([#5](https://github.com/southleft/story-ui/issues/5)) ([7fe706a](https://github.com/southleft/story-ui/commit/7fe706aeaca487cf4905be7598264bfc4bc2f902))

## [2.0.1](https://github.com/southleft/story-ui/compare/v2.0.0...v2.0.1) (2025-07-22)


### Bug Fixes

* remove default Storybook components during init to prevent conflicts ([a1b1f27](https://github.com/southleft/story-ui/commit/a1b1f274d17ed91d2ff32b056cae2b50b861b81c))

# [2.0.0](https://github.com/southleft/story-ui/compare/v1.7.0...v2.0.0) (2025-07-22)


*  Guided Design System Installation with Auto-Configuration ([#2](https://github.com/southleft/story-ui/issues/2)) ([bc35023](https://github.com/southleft/story-ui/commit/bc3502355d9508313271fbaf210e60772b3ef671)), closes [#0052](https://github.com/southleft/story-ui/issues/0052)


### Bug Fixes

* **ci:** disable footer line length limit for semantic-release ([#3](https://github.com/southleft/story-ui/issues/3)) ([e7625d6](https://github.com/southleft/story-ui/commit/e7625d6cdc33506a3be5b2e1ede3344277c4a338))
* remove all baseui references and fix protected branch workflow ([0cb2fe1](https://github.com/southleft/story-ui/commit/0cb2fe15fe86beb1cbdda4cc622b6893005c33a2))
* remove hardcoded user paths from story-ui.config.js ([9494bd5](https://github.com/southleft/story-ui/commit/9494bd53d149fe2a37ee7744643d1f74d3b74bfb))


### BREAKING CHANGES

* Removed Playwright web scraping in favor of Context7 MCP integration

- Replace Playwright documentation scraping with Context7 MCP server
- Context7 provides real-time, curated documentation for popular libraries
- No setup required - documentation is fetched automatically
- Only current, valid components are provided (no deprecated components)
- Remove 'scrape-docs' and 'clear-docs-cache' CLI commands
- Add bundled documentation as fallback when Context7 is unavailable
- Enhanced component validation to prevent deprecated component usage
- Remove Playwright dependency from package.json

Benefits:
- Zero configuration required for documentation
- Always up-to-date with latest library versions
- No maintenance of web scrapers
- Consistent, reliable documentation format
- Better AI story generation with accurate component info

Migration guide available in docs/MIGRATION_TO_CONTEXT7.md

* feat: implement Context7 integration for real-time documentation

- Add Context7 integration for up-to-date component documentation
- Enhance story generation with multiple story variants
- Fix toLowerCase() undefined errors in component discovery
- Improve error handling and validation in story generation
- Update prompt generation to leverage Context7 documentation

* refactor: implement environment-specific Context7 integration

- Move Context7 configuration from main app to environment-specific setup
- Create context7-config.json files for each test environment
- Update CLI setup to generate Context7 config during initialization
- Remove hardcoded design system mappings from main application
- Make Context7 integration truly environment-agnostic
- Support custom design systems with local Context7 configuration
- Maintain architectural separation between main app and test environments

This ensures the main Story UI application remains agnostic while
allowing each Storybook environment to have its own Context7 setup.

* chore: remove .cursor and .claude from repository and add to .gitignore

* refactor: remove multi-instance infrastructure and introduce auto port detection

* feat: remove context7 integration and add documentation loader

- Removed Context7 MCP tool integration and related files
- Added new DocumentationLoader for directory-based documentation
- Enhanced prompt generation to support both legacy considerations files and new documentation directories
- Fixed async/await issues in buildClaudePrompt functions
- Added glob dependency for file discovery
- Created documentation structure for Material-UI test storybook
- Updated configuration to remove Context7 references

This sets the foundation for better design system documentation support and prepares for iteration improvements.

* feat: implement story iteration support with version history

- Added StoryHistoryManager to track all versions of generated stories
- Enhanced buildClaudePromptWithContext to include previous code for iterations
- AI now receives the actual generated code when modifying stories
- Added explicit instructions to preserve existing code and only modify requested aspects
- History files stored in .story-ui-history directory (git-ignored)
- Each story version linked to parent for iteration tracking

This ensures non-developers can safely iterate on layouts without fear of losing their original design.

* docs: update README and remove Spectrum/Context7 references

- Updated README with new documentation system and iteration features
- Removed all Context7 integration references
- Removed Adobe Spectrum from supported design systems
- Added documentation for directory-based docs structure
- Added production mode and CLI commands documentation
- Cleaned up post-processing to remove Spectrum-specific code
- Updated package.json keywords to reflect current features

* chore: remove accidentally added StoryUI files from main project root

These files should only exist in templates/ and test-storybooks/ directories

* feat: clean up test storybook instances and fix story generation issues

- Fix material-ui story using children in args anti-pattern
- Overhaul shadcn-storybook-registry to be component-first instead of Tailwind-first
- Update shadcn documentation to promote Alert components over custom divs
- Replace Banner component references with proper Alert component usage
- Align all test instances with Story UI's design-system-first philosophy
- Add proper component composition examples and guidelines
- Remove utility-first approaches that contradict Story UI principles

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix: add missing package.json files and Story UI dependencies

- Create package.json for mantine-storybook (was missing entirely)
- Add @tpitre/story-ui dependency to ant-design-storybook
- Ensure all test storybooks are properly linked to core Story UI package
- Fix npm run story-ui command execution in all test environments

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix: increase token limit and add truncation detection for story generation

- Increase max_tokens from 4096 to 8192 to prevent story truncation
- Add validation check for truncated stories with multiple closing tags
- Add validation for missing export default meta statement
- Fix manually truncated kanban dashboard story in Atlassian storybook

This prevents incomplete story generation that causes Storybook syntax errors.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* feat: add Atlassian branding to Storybook and update branding script
* Auto-discovery no longer includes @base_ui, @shopify/polaris, and other
unstable systems. Use guided installation for supported systems or manual configuration.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* refactor: remove unsupported design systems and cleanup codebase

- Remove @base_ui references from CLI and config files
- Remove Shopify Polaris documentation and references
- Clean up package.json dependencies (remove baseui, styletron, storybook)
- Remove unnecessary scripts directory entirely
- Simplify componentBlacklist.ts to remove Polaris-specific logic
- Clean documentation-sources.ts of all bundled documentation
- Update comments to reference only supported design systems

This ensures the codebase only contains references to the 3 officially supported
design systems: Chakra UI, Ant Design, and Mantine.

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* refactor: remove all remaining references to unsupported design systems

- Remove baseui references from setup.ts interface and choices
- Update promptGenerator.ts example to use antd instead of baseui
- Clean universalDesignSystemAdapter.ts to only support Chakra UI, Ant Design, and Mantine
- Remove context7 configuration from story-ui.config.js
- Update react-import-rule.json examples to use antd instead of Shopify Polaris

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix: resolve contradictory rules in prompt generator

- Remove Base UI specific UNSAFE_style prohibition
- Update provider component rule to be design system agnostic
- Clarify that theme providers should be at app level, not in stories
- Resolves contradiction with ChakraProvider setup instructions

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>

# [1.7.0](https://github.com/southleft/story-ui/compare/v1.6.0...v1.7.0) (2025-06-19)


### Bug Fixes

* add environment protection to cleanup scripts - only remove .env files created by Story UI ([a698817](https://github.com/southleft/story-ui/commit/a698817ee5292e1f58a7193717c35b24b0adc585))
* add missing story-ui.config.ts file to resolve build errors ([5bb8f7a](https://github.com/southleft/story-ui/commit/5bb8f7a7478eb956367f9b34aadca7cc72371cc8))


### Features

* add comprehensive cleanup scripts for testing and demos ([5c3da22](https://github.com/southleft/story-ui/commit/5c3da221b9bf8458c8efc2bd1338ead76f29566e))
* add smart push script to handle automatic rebasing ([baed025](https://github.com/southleft/story-ui/commit/baed02597e5f357e8f5f4603ae3b8f0801604d48))
* add test project management system for clean testing cycles ([22b95a6](https://github.com/southleft/story-ui/commit/22b95a6aac8570b4a3b8335068ce243b2bee9cb6))

# [1.6.0](https://github.com/southleft/story-ui/compare/v1.5.2...v1.6.0) (2025-06-18)


### Features

* add GitHub templates, roadmap and project cleanup ([d4866db](https://github.com/southleft/story-ui/commit/d4866db1925ce305ba70a22c28d02e4e66aab9dd))

## [1.5.2](https://github.com/southleft/story-ui/compare/v1.5.1...v1.5.2) (2025-06-18)


### Bug Fixes

* support external design systems without local components directory ([2b6de67](https://github.com/southleft/story-ui/commit/2b6de6729b09697f571909b6abc62ba7e56a055f))

## [1.5.1](https://github.com/southleft/story-ui/compare/v1.5.0...v1.5.1) (2025-06-17)


### Bug Fixes

* **generator:** improve handling of truncated AI responses ([5924329](https://github.com/southleft/story-ui/commit/5924329ada8be82beedaad48e09edfd24a030612))

# Unreleased

### Bug Fixes
- **generator:** Fixed AI response truncation by increasing max_tokens from 1024 to 4096
- **validation:** Enhanced JSX closing tag detection and automatic fixing for truncated responses
- **validation:** Added intelligent truncation detection and recovery mechanisms
- **validation:** Improved handling of missing braces and incomplete code structures

# [1.5.0](https://github.com/southleft/story-ui/compare/v1.4.0...v1.5.0) (2025-06-17)


### Features

* enhanced component discovery system for design systems ([ee4e8c4](https://github.com/southleft/story-ui/commit/ee4e8c4dc45800d12965bf443506551f988b925d))

# [1.4.0](https://github.com/southleft/story-ui/compare/v1.3.0...v1.4.0) (2025-06-17)


### Features

* **generator:** implement story update mode to prevent duplicates ([9a67841](https://github.com/southleft/story-ui/commit/9a67841fb1a80145d739ed682bdbb4054032b4e4))

# [1.3.0](https://github.com/southleft/story-ui/compare/v1.2.0...v1.3.0) (2025-06-17)


### Features

* **generator:** add TypeScript validation system for generated stories ([845ec1b](https://github.com/southleft/story-ui/commit/845ec1b3b1ed0e67457cef054e4c3dae74f8c1c7))

## [1.1.1](https://github.com/southleft/story-ui/compare/v1.1.0...v1.1.1) (2025-06-17)


### Bug Fixes

* resolve Story UI port configuration and path resolution issues ([2059b51](https://github.com/southleft/story-ui/commit/2059b519e469610529caffffdbe564ed1f19cd7b))

# [1.1.0](https://github.com/southleft/story-ui/compare/v1.0.1...v1.1.0) (2025-06-16)


### Bug Fixes

* **config:** fixing commit lint ([1f2684e](https://github.com/southleft/story-ui/commit/1f2684e0b1db4c6d17585580b5a4214b4b419d0e))
* **deps:** correct commitizen version to 4.3.1 ([ba6c8f1](https://github.com/southleft/story-ui/commit/ba6c8f1478bdb27d4d2f9f642dc61b429d014ecd))


### Features

* **config:** add commit message validation with husky and commitlint ([a842214](https://github.com/southleft/story-ui/commit/a84221426462264bb53e1d1f8300a5426e247dfc))

## [1.0.1](https://github.com/southleft/story-ui/compare/v1.0.0...v1.0.1) (2025-06-16)


### Bug Fixes

* add publishConfig for scoped package npm publishing ([af860c2](https://github.com/southleft/story-ui/commit/af860c20adf0bf1f00dfd54f6927cd1a2f1907ec))
* **ci:** add package-lock.json for npm ci in GitHub Actions ([0a552d9](https://github.com/southleft/story-ui/commit/0a552d91254a4b73a5cf0a4e2e95fbb81d430fec))
* **ci:** sync package-lock.json and upgrade to Node.js 20 for semantic-release ([db7591f](https://github.com/southleft/story-ui/commit/db7591fbfa84a174e0c8a3e4905028e9b7d7caba))
* **ci:** update GitHub Actions checkout for semantic-release compatibility ([5f7a3ea](https://github.com/southleft/story-ui/commit/5f7a3ea0829ce82b7f1184c731c6a682fde3596b))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-06-16

### Added
- Initial release of Story UI
- AI-powered story generation using Claude API
- Interactive setup command (`npx story-ui init`)
- Built-in Storybook UI panel component
- Support for multiple design systems (Material-UI, Chakra UI, Ant Design, etc.)
- Automatic component discovery
- Smart layout generation
- In-memory story storage for production environments
- File-based story storage for development
- Git integration with automatic .gitignore management
- MCP server for Claude Desktop integration
- Comprehensive documentation and examples

### Features
- Natural language prompt to UI generation
- Multi-column layout support
- Component library agnostic architecture
- TypeScript support
- Conversation history and chat sessions
- Real-time story synchronization
- Memory-efficient production deployment
