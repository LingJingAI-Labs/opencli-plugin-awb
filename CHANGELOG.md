# Changelog

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
