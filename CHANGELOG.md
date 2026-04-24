# Changelog

## 0.1.6 - 2026-04-24

- Add agent-friendly `subject-publish` and `subject-publish-batch` workflows for reusable human subject assets.
- Upgrade `subject-status` to query published third-party assets and infer whether a subject is already reusable.
- Add `subject-group-update` so agents can quickly rewrite subject group names/descriptions when moderation-sensitive wording blocks publication.
- Make `subject-publish` default to safe publish naming while preserving human-readable `refSubjects` aliases.
- Improve `upload-files` output with `groupId`, direct reuse hints, and direct subject-registration hints.
- Document the full AWB subject workflow: `upload-files -> subject-publish -> video-create --refSubjects`, including batch and moderation guidance.

## 0.1.5 - 2026-04-23

- Fix Kling 3 storyboard payloads by auto-filling `multi_prompt` `index` and second-based `duration`, with client-side duration-sum validation.
- Fix first-frame video prompts by copying global `--prompt` into the first frame text when `--frameText` is omitted.
- Update AWB skill video/storyboard docs for mode exclusivity, storyboards duration semantics, and Kling 3 reference-mode 15s caveat.
- Add CLI-side guard for verified Kling 3 (non-Omni) reference-video mode at 15s, based on 2026-04-24 live verification (10s works, 15s fails).
- Confirm via live task run that Kling 3.0-Omni `multi_param` reference-video mode can complete successfully at 15s.
- Document the high-frequency workflow of uploading reusable video references to `material-video-create` and reusing backendPath via `refImageUrls`.
- Improve `upload-files` output with `groupId` and copy-ready reuse hints for `--iref` / `--refImageUrls` / `--refVideoUrls` / `--refAudioUrls`.
- Fix `upload-files --dryRun true` nested-array output bug so preview rows match real upload structure.
- Verify via live task run that `upload-files -> backendPath -> refImageUrls` works for AWB reference-video creation.
- Add `subject-publish` as the agent-friendly alias for reusable human/character subject registration.
- Verify via live task run that `upload-files -> subject-publish/subject-upload -> refSubjects` works for Seedance 2.0 subject-reference video creation.
- Pin `@jackwener/opencli` to exact `1.6.8` in `awb-core` dependencies. 1.6.9+ upgraded its `undici` to `^8.0.2` (while still declaring `engines.node >= 20.0.0`), which crashes at runtime on Node 20 with `TypeError: webidl.util.markAsUncloneable is not a function`. Pinning to 1.6.8 (the last version on undici 7) restores Node 20 compatibility.

## 0.1.4 - 2026-04-23

- Restructure AWB skill into `modules/` (8 sub-skills with 经验引导) + `references/` (4 deep dives: subject-upload, model-options, batch-input, storyboard); replaces flat `capabilities/` + `workflows/`
- Support GPT Image 2 model group in skill examples
- Tighten `agents/openai.yaml` short description to match the module surface
- (Carried over) Co-located `skills/awb` skill bundle with capability docs, workflows, and update scripts
- (Carried over) Skill compatibility metadata and update mechanism documentation

## 0.1.0

- Initial AWB CLI plugin
- Add standalone `awb` CLI skeleton and shared `awb-core`
- Hide internal-only models from non-internal visibility scopes
