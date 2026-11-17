# 智能装柜 · 集装箱装载模拟

纯静态网页应用（无需后端、无需构建），手机和电脑浏览器都能用，也可"添加到主屏幕"作为 PWA 离线使用。

## 运行

```bash
cd zhuanggui
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

> 必须通过 http(s) 访问（ES Module + importmap），直接双击 index.html（file://）无法加载 3D 引擎。
> 部署：把整个目录上传到任意静态托管（Nginx、OSS/COS、GitHub Pages、Vercel、Netlify 等）即可。

## 功能

- 柜型：20GP / 40GP / 40HQ / 45HQ + 自定义柜内尺寸（含 13m 平板车快捷填充，本地记忆）
- 货物清单：品名、长宽高、件数、单重；形状（方箱 / 圆柱·卷 / 圆形件）；摆放（自动 / 平放 / 竖放 / 侧立）；可翻转、不可堆叠、允许斜放
- 排柜算法：LAFF + 极值点 + 重力落位 + 88% 承托校验，多策略择优；超长件斜放；超载/空间不足分类
- 🤖 智能满载：横/竖/侧立混排、沿柜长分段配重、左右均衡、剩余空档用补位箱补满，弹出满载报告
- 自动配平（同尺寸互换 + 单件移位），横放圆柱自动加止挡木
- 3D 视图：立体 / 柜门正视 / 侧视 / 俯视，分层查看，显示/隐藏柜体，拖动旋转、缩放、平移
- 装载动画：播放/暂停、进度拖动、0.5–8 倍速、当前件高亮；装载顺序面板（柜头→柜门，点击跳转）
- 导出：装载清单 CSV（Excel 可直接打开）、装载动画视频（WebM，Chrome/Edge）
- 表格导入：Excel(.xlsx/.xls) / CSV / 直接粘贴，中英文表头自动识别，cm/mm/m 自动换算，模板下载
- 统计：体积装载率环、已装/总件数、体积、毛重/限重、层数、重心偏移、剩余体积 + 现场装柜提醒
- 分享链接（?s=方案编码）、自动保存上次方案、URL 参数：`?box=20GP&preset=daily&step=50&panel=order|import|items`
- 移动端：底部抽屉清单、顶部装载率胶囊；PWA manifest + Service Worker 离线缓存

## 目录

```
index.html          页面结构
css/app.css         样式
js/app.js           界面与交互
js/packer.js        排柜算法（LAFF + 极值点、斜放、配平、止挡木）
js/smart.js         智能满载算法
js/geom.js          空间索引 / 碰撞 / 承托 / 姿态
js/scene.js         three.js 场景、视角、动画
js/importer.js      表格导入
vendor/             three.js r160、OrbitControls、RoundedBoxGeometry、SheetJS xlsx 0.18.5
manifest.json, sw.js, icon.svg, icon-192.png, icon-512.png   PWA
custom-loader.html / alu-loader.html / dapei.html            子模块占位页
```
