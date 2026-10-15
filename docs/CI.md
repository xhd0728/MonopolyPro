# 自动检查与依赖更新

配置核对日期：2026-10-15。工作流随源码提交；本地检查成功不代表 GitHub 托管任务已经运行。需要将提交推送到 GitHub 后，才能在 Actions / Security 页面确认实际结果。

## 检查内容

| 检查                            | 触发                      | 内容                                                                                                            |
| ------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| CI / Node checks                | main 推送、PR、手动、每周 | Node 22.16.0、22.x、24.x；冻结锁文件安装、Prettier、TypeScript、生产构建、自动化测试、60 场规则与财务不变量模拟 |
| CI / Chromium journeys          | Node 检查成功后           | 构建生产包，在独立数据库和本地服务中运行 Playwright；失败时保存截图、trace、报告 7 天                           |
| CI / Dependency vulnerabilities | 同上                      | `pnpm audit --audit-level=high`，高危及以上漏洞使检查失败                                                       |
| CodeQL                          | main 推送、PR、手动、每周 | JavaScript/TypeScript 与 GitHub Actions 安全分析，结果提交至代码扫描                                            |

检查使用最小读取权限；CodeQL 单独获得上传扫描结果的权限。第三方 Action 固定到完整提交 SHA，由 Dependabot 提交更新 PR；checkout 不保留 Git 凭证。不使用 `pull_request_target` 执行 PR 代码，不自动部署、不自动合并。CI 明确关闭外部 LLM，测试使用本地提供者替身，不需要 API 密钥。

Node 矩阵覆盖声明的最低版本和主要验证版本，不把新主版本挡在安装范围之外。引擎要求仍为 `^22.16.0 || >=23.8.0`，最低版本来自内置 SQLite 和在线备份接口。具体支持范围与验证记录见 [运行环境说明](DEPLOY.md)。

模拟脚本在出现非法动作或对局未结束时返回非零退出码，避免只打印错误数量却让 CI 通过。它检查规则一致性，不衡量机器人是否最优或玩法是否平衡。

## Dependabot

每周一北京时间 04:00 检查 npm/pnpm 依赖，04:30 检查 Actions。普通依赖更新冷却 7 天，同类 minor/patch 更新分组：React、Colyseus、其他生产依赖、开发依赖；major 更新单独评审。安全修复另设分组，不自动合并。

GitHub 文档的支持表在调研时仍列 pnpm 7–10，但 Dependabot 的 [pnpm 管理器源码](https://github.com/dependabot/dependabot-core/blob/main/npm_and_yarn/lib/dependabot/npm_and_yarn/pnpm_package_manager.rb) 已包含 pnpm 11/12；[支持 pnpm 11.25.0 的变更](https://github.com/dependabot/dependabot-core/pull/16169) 于 2026-09-15 合并，因此保留项目的 pnpm 11.25.0，无须换包管理器。实际托管服务的首次更新仍需在推送后核对。

本配置负责版本更新 PR。自动安全更新还受仓库的 Dependency graph、Dependabot alerts / security updates 设置控制，本轮没有修改这些远端设置。也没有设置分支保护；后续可将稳定运行的 CI / CodeQL 检查设为合并前必需条件。

## 本地复核

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm exec tsx scripts/simulate.ts 60
pnpm test:ui
pnpm audit --audit-level=high
```

本地另用 actionlint 校验工作流 YAML 与表达式。首次新增配置已在本地通过 actionlint 1.7.12；不将此结果等同于远端 CodeQL 扫描通过。

参考：[Dependabot 配置](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)、[Dependabot 触发 Actions 的权限](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)、[Action SHA 固定策略](https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/)、[CodeQL 工作流配置](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options)。
