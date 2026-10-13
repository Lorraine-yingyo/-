# 条件实验室 · 腾讯云部署

正式入口为 https://condition-lab.jobgrowthos.cn/。2026-10-13 候选人已完成部署、DNS 与 HTTPS 配置，提供健康检查 200 截图。以下安装步骤用于新环境复现；已有部署不要重复安装。

安装包复用 app/page.tsx、筛选引擎和三个 API 的源代码，浏览器端本地打包 React/CSS/数据，Node 服务提供 API；运行时不依赖 ChatGPT 登录或外部字体、脚本 CDN。无需服务器 npm install。构建使用 Vite 官方的客户端及 Node 服务端打包能力：https://vite.dev/guide/ssr 。

## 安装步骤

1. 在现有域名的 DNS 中仅新增 A 记录：condition-lab → 124.221.102.89，不修改 @、www 或其他项目记录。
2. 用腾讯云 Workbench 的上传功能将 condition-lab-tencent.tar.gz 上传到 ubuntu 用户主目录。
3. 终端执行：

```sh
mkdir -p ~/condition-lab-release
cd ~/condition-lab-release
tar -xzf ~/condition-lab-tencent.tar.gz
sudo bash install.sh condition-lab.jobgrowthos.cn
```

4. 要求服务器已有 Node.js ≥22.13、Nginx、systemd。安装器检测目录、服务、端口或域名配置冲突时会停止；不会替换 Node 或已有网站配置。
5. DNS 生效后使用服务器既有证书工具配置 HTTPS，例如已安装 certbot 时执行 `sudo certbot --nginx -d condition-lab.jobgrowthos.cn`。如果需要注册证书账户或接受协议，由所有者确认。域名资质与备案沿用现有资源，是否适用需在控制台确认。
6. 访问最终 HTTPS 入口，检查输入解析、筛选、添加条件、保存、刷新。用手机流量关闭代理再测一次。HTTP 仅用于证书配置前的健康检查；正式交付须使用 HTTPS，以保证浏览器安全上下文功能可用。

## 独立服务与回退

- 程序：/opt/condition-lab；仅监听 127.0.0.1:4319。
- systemd：condition-lab.service；Nginx 独立配置名 condition-lab。
- 既有主站、3000 端口及流麻应用的 4318 端口不改动；不新增公网业务端口。
- 状态：`sudo systemctl status condition-lab --no-pager`；日志：`sudo journalctl -u condition-lab -n 30 --no-pager`。
- 撤下新入口：仅 unlink /etc/nginx/sites-enabled/condition-lab，nginx -t 成功后 reload nginx，再停止 condition-lab。保留程序和文档，不删除现有网站或用户数据。

默认无需密钥。可选模型和扶摇配置放在仅管理员可读的 /etc/condition-lab.env；变量说明见项目 README。安装包不包含密钥、个人策略或其他项目数据。策略仍保存在当前浏览器；更换域名不会自动迁移旧域名的 localStorage。
