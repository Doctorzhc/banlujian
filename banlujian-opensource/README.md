# 半路见 · 大家都方便的见面点

两个人约在哪？输入双方位置，「半路见」给出对你们俩都方便的见面点。

在线体验：**https://banlujian-dfvs9jc0vdj.qoder.zone**

## 功能

1. **位置输入**：双方各自输入出发点（学校、小区、公司均可），高德 POI 联想自动补全。
2. **折中推荐**：以两人连线中点为圆心搜索咖啡/美食/书店/商场/公园五类场所，调用高德距离矩阵接口实测双方真实耗时，按「走得最远的人尽量少走 → 两人总耗时更短 → 离中点更近」三重排序，保证公平。
3. **地图可视化**：高德 JS API 展示双方位置、候选点与实时路线，点击候选卡片地图联动切换。
4. **路线详情**：每个候选点展示双方驾车/步行方案的耗时与距离。
5. **AI 偏好微调**：一句话描述偏好（如「想找个安静能看书的地方」），通义千问（qwen-flash）从候选中挑选更符合的并给出理由；大模型不可用时规则引擎无缝兜底。
6. **响应式设计**：手机、平板、电脑均可流畅使用。

## 技术栈

- 前端：React 19 + TypeScript + Vite + Tailwind CSS 4（shadcn/ui 组件）
- 后端：Deno Edge Function（Qoder Sites Functions），同源端点 `/functions/v1/app`
- 数据：高德开放平台 Web 服务 API（输入提示 / 周边搜索 / 距离矩阵 / 路径规划）
- AI：阿里云百炼 DashScope 兼容模式（通义千问 qwen-flash）

## 安全设计

所有第三方密钥（高德 Key、DashScope API Key）只存在于服务端环境变量，浏览器永远接触不到；前端仅同源调用自有后端。未配置密钥时自动返回演示数据（响应带 `mock` 标记），方便无凭据运行与开发。

## 本地开发

```sh
npm ci
npm run dev          # 前端 + 本地 Function 代理（需 Deno）
npm run check:function
npm run build        # 产出 dist/
```

本地密钥放在 `dev/local.env`（已被 gitignore，勿提交）。本地 Function 入口见 `package.json` 的 `dev:function` 脚本。

## 部署

通过 Qoder Sites 发布：`webDirectory: "dist"`、`functionDirectory: "functions"`，在站点 Settings 中配置 `AMAP_WEB_KEY`、`AMAP_JS_KEY`、`AMAP_JS_SECURITY_CODE`、`DASHSCOPE_API_KEY` 四个 Secret。

## License

[MIT](./LICENSE)
