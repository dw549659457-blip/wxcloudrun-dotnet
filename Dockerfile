# pnpm 锁定安装管理前端；小程序单独在开发者工具发布，不放进服务镜像。
FROM node:24.19.0-bookworm-slim AS admin-build
WORKDIR /frontend
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/ ./packages/contracts/
COPY apps/admin/ ./apps/admin/
COPY apps/miniprogram/package.json ./apps/miniprogram/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @warehouse/admin build

# 保留模板构建入口与 80 端口；MySQL 使用云托管关联实例，不放进应用镜像。
FROM mcr.microsoft.com/dotnet/sdk:10.0.401 AS build
WORKDIR /source
COPY global.json ./
COPY aspnetapp/aspnetapp.csproj aspnetapp/packages.lock.json ./aspnetapp/
RUN dotnet restore aspnetapp/aspnetapp.csproj --locked-mode
COPY aspnetapp/ ./aspnetapp/
COPY database/migrations/ ./database/migrations/
RUN dotnet publish aspnetapp/aspnetapp.csproj -c Release --no-restore -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0.12 AS runtime
WORKDIR /app
COPY --from=build /app ./
COPY --from=admin-build /frontend/apps/admin/dist ./wwwroot/admin
# 当前用户已明确选择 vegetable_prod 与托管 root；控制台同名变量可覆盖。
# 密码继续由微信云托管 MYSQL_PASSWORD 注入，不放进镜像或 Git。
ENV ASPNETCORE_ENVIRONMENT=Production PORT=80 MYSQL_DATABASE=vegetable_prod MYSQL_ALLOW_ROOT=true
EXPOSE 80
# 保持原模板默认运行用户，兼容云托管 80 端口监听。
ENTRYPOINT ["dotnet", "aspnetapp.dll"]
