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
ENV ASPNETCORE_ENVIRONMENT=Production PORT=80
EXPOSE 80
USER app
ENTRYPOINT ["dotnet", "aspnetapp.dll"]
