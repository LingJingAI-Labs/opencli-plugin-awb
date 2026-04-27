# Changelog

## 0.1.17 - 2026-04-27

- Load user-level env files for AWB / AiHubMix credentials, including simple `export AIHUBMIX_KEY=...` lines in `~/.zshrc`, without executing shell scripts.

## 0.1.16 - 2026-04-27

- Treat `happyhorse-1.0-i2v` as source-ratio image-to-video: model hints and examples no longer suggest `--ratio`, `--size`, or `--quality`, and those flags are rejected for i2v.

## 0.1.15 - 2026-04-27

- Remove HappyHorse audio-reference claims and reject `--refAudio*` / `--audio` flags on AiHubMix HappyHorse video models.

## 0.1.14 - 2026-04-27

- Hide backend-only model scene blacklist metadata from CLI model list `raw` output so `blackList` / `Anime_Script_*` does not mislead model selection.

## 0.1.13 - 2026-04-27

- Align `happyhorse-1.0-r2v` with AiHubMix HappyHorse request shape: `input.prompt`, `input.media`, and `parameters`.
- Validate r2v reference image count, public URL requirement, ratio, resolution, and 3-15 second duration before submitting.
- Document r2v `character1` / `character2` reference ordering and supported media constraints.

## 0.1.12 - 2026-04-27

- Add HappyHorse / AiHubMix external cost estimates to `video-fee`, `video-create --dryRun true`, and created task output.
- Estimate USD and CNY from AiHubMix HappyHorse per-second prices while keeping `pointCost: null` so external billing is not confused with AWB project-group points.
- Allow price overrides through `AIHUBMIX_HAPPYHORSE_720P_USD_PER_SECOND`, `AIHUBMIX_HAPPYHORSE_1080P_USD_PER_SECOND`, and `AIHUBMIX_CNY_PER_USD`.

## 0.1.11 - 2026-04-27

- Add AiHubMix HappyHorse external video model support for `happyhorse-1.0-t2v`, `happyhorse-1.0-i2v`, `happyhorse-1.0-r2v`, and `happyhorse-1.0-video-edit`.
- Let `video-create`, `video-fee`, `video-models`, and `model-options` understand HappyHorse as an external provider that reads `AIHUBMIX_API_KEY` and does not consume AWB project-group points.
- Add `aihubmix-video-status` and `aihubmix-video-download` for polling `/v1/videos/{video_id}` and downloading `/content`.

## 0.1.10 - 2026-04-27

- Add `task-duration-stats` to query the task execution statistics dashboard for best-effort average duration estimates by `bizType`, `platformType`, `modelUseType`, and `channel`.
- Add Seedance 2.0 post-generation subtitle removal commands via asset-edit watermark API: `seedance-subtitle-remove` and `seedance-subtitle-status`.
- Document the Seedance 2.0 subtitle-removal constraints: only use the original Volcengine/Seedance result URL, submit within 24 hours when using the free path, and treat returned `public_id` as the follow-up task ID.

## 0.1.9 - 2026-04-27

- Add explicit pre-submit confirmation rules for AWB generation: model channel, prompt, references, cost, wait strategy, image ratio / 1K-2K-4K quality, image count, video ratio / 720-1080 quality, duration, audio, and subject references.
- Add local task record support via `--taskRecordFile`, plus `task-records` and `task-record-poll` for async/batch task recovery.
- Document async-first task handling for video, long image, token-priced, and batch jobs.
- Use the task execution statistics dashboard for average duration estimates and default usage summaries to `1` point = `0.1` yuan.

## 0.1.7 - 2026-04-26

- Add AWB skill guidance for真人短剧生产流：主体 / 人设图 + 场景图 + 可选音色的参考生视频默认路线。
- Document model selection tradeoffs for Seedance 2.0, Seedance 2.0 Fast, Kling 3.0 / Omni, Grok, and other reference-video models.
- Add the 4/9 宫格分镜指挥图 workflow: use Banana Pro / Nano Banana / GPT Image 2 to create a shotboard image, then feed it with subject/persona and scene references into Seedance, Kling, Grok, Veo, Vidu, PixVerse, etc.
- Clarify 720p as the default automation resolution for Seedance 2.0, with 1080p called out as a higher-cost option.

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
