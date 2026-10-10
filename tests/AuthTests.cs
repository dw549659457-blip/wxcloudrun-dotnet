using System.Net;
using System.Net.Http.Headers;
using System.Text;
using aspnetapp.Configuration;
using aspnetapp.Domain;
using Xunit;
using static Business.Tests.TestFixture;

namespace Business.Tests;

public sealed class AuthTests(TestFixture fixture) : IClassFixture<TestFixture>
{
    [Fact]
    public async Task Object_permissions_and_role_permissions_apply_to_direct_requests()
    {
        var (packaging, vegetable) = await fixture.Stock(); var batch = await fixture.Dispatch(packaging);
        var work = await fixture.Create("worker1", "work-records", new(new(2026, 10, 1), [new(packaging, 1)], batch, Vegetables: [new(vegetable, 1)]));
        Assert.Equal(HttpStatusCode.Forbidden, (await fixture.Clients["worker1"].GetAsync("/api/reports/monthly-loss")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await fixture.Clients["outbound1"].GetAsync("/api/inventory/packaging")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await fixture.Clients["worker2"].GetAsync($"/api/work-records/{work}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await fixture.Clients["driver2"].GetAsync($"/api/batches/{batch}/summary")).StatusCode);
        var recovery = await Send(fixture.Clients["driver2"], HttpMethod.Post, "/api/recoveries", new DraftInput(new(new(2026, 10, 1), [new(packaging, 1)], batch, Mode: "PARTIAL"), true));
        Assert.Equal(HttpStatusCode.NotFound, recovery.StatusCode);
        var summary = await Json(await fixture.Clients["worker1"].GetAsync($"/api/batches/{batch}/summary"));
        Assert.False(summary.GetProperty("packaging")[0].TryGetProperty("lost", out _));
        Assert.Equal(0, summary.GetProperty("vegetables").GetArrayLength());
    }
    [Fact]
    public async Task Public_spoofed_wechat_headers_and_client_supplied_identity_are_rejected()
    {
        using var client = fixture.Factory.CreateClient();
        client.DefaultRequestHeaders.Add("x-wx-openid", "administrator"); client.DefaultRequestHeaders.Add("x-wx-appid", "test-app");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/reports/vegetable-outbound/excel")).StatusCode);
        var response = await client.PostAsync("/api/auth/wechat-login", new StringContent("{\"code\":\"login\",\"openid\":\"admin\",\"role\":\"ADMIN\"}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/does-not-exist")).StatusCode);
        Assert.Equal("application/json", (await client.GetAsync("/api/does-not-exist")).Content.Headers.ContentType?.MediaType);
    }
    [Fact]
    public async Task First_phone_binding_requires_personal_confirmation_then_relogin_needs_no_phone()
    {
        using var client = fixture.Factory.CreateClient();
        var login = await Send(client, HttpMethod.Post, "/api/auth/wechat-login", new WechatLoginInput("worker-phone-identity"));
        var token = (await Json(login)).GetProperty("bindingToken").GetString()!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        var phone = await Send(client, HttpMethod.Post, "/api/auth/bind-phone", new PhoneBindingInput(token, "13800000003")); phone.EnsureSuccessStatusCode();
        Assert.Equal("PENDING_CONFIRM", (await Json(phone)).GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        var confirm = await Send(client, HttpMethod.Post, "/api/auth/confirm-binding", new BindingTokenInput(token)); confirm.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await Json(confirm)).GetProperty("token").GetString());
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        var again = await Json(await Send(client, HttpMethod.Post, "/api/auth/wechat-login", new WechatLoginInput("worker-phone-identity")));
        Assert.True(again.TryGetProperty("token", out _)); Assert.False(again.TryGetProperty("bindingToken", out _));
    }
    [Fact]
    public async Task Assisted_binding_has_no_access_until_admin_approval_and_employee_confirmation()
    {
        var account = new UserInput("help-" + Guid.NewGuid().ToString("N"), "协助员工", "13900000001", [Roles.Worker]);
        var created = await Send(fixture.Clients["admin"], HttpMethod.Post, "/api/users", account); created.EnsureSuccessStatusCode();
        var user = (await Json(created)).GetProperty("id").GetInt64();
        using var client = fixture.Factory.CreateClient();
        var login = await Json(await Send(client, HttpMethod.Post, "/api/auth/wechat-login", new WechatLoginInput("assisted-identity")));
        var token = login.GetProperty("bindingToken").GetString()!;
        var request = await Json(await Send(client, HttpMethod.Post, "/api/auth/binding-requests", new BindingTokenInput(token)));
        var requestId = request.GetProperty("requestId").GetInt64();
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, "/api/auth/confirm-binding", new BindingTokenInput(token))).StatusCode);
        (await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/auth/binding-requests/{requestId}/approve", new BindingDecisionInput(user, "本人手机线下核实"))).EnsureSuccessStatusCode();
        var confirmed = await Json(await Send(client, HttpMethod.Post, "/api/auth/confirm-binding", new BindingTokenInput(token)));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", confirmed.GetProperty("token").GetString());
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        (await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/auth/users/{user}/unbind", new ReverseInput("员工更换微信"))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }
    [Fact]
    public async Task Admin_cookie_requires_csrf_and_disabled_account_revokes_existing_sessions()
    {
        var password = "Test-case-only-password-2026";
        var input = new UserInput("admin-" + Guid.NewGuid().ToString("N"), "测试管理员", "13900000002", [Roles.Admin], Password: password);
        var response = await Send(fixture.Clients["admin"], HttpMethod.Post, "/api/users", input); response.EnsureSuccessStatusCode();
        var id = (await Json(response)).GetProperty("id").GetInt64();
        using var browser = fixture.Factory.CreateClient();
        var login = await Send(browser, HttpMethod.Post, "/api/auth/admin-login", new LoginInput(input.Username, password)); login.EnsureSuccessStatusCode();
        Assert.Contains("httponly", string.Join(";", login.Headers.GetValues("Set-Cookie")).ToLowerInvariant());
        Assert.False((await Json(login)).TryGetProperty("token", out _));
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser, HttpMethod.Post, "/api/growers", new ArchiveInput("CSRF拒绝"))).StatusCode);
        browser.DefaultRequestHeaders.Add("X-CSRF-Token", (await Json(login)).GetProperty("csrfToken").GetString());
        (await Send(browser, HttpMethod.Post, "/api/growers", new ArchiveInput("CSRF通过"))).EnsureSuccessStatusCode();
        (await Send(fixture.Clients["admin"], HttpMethod.Put, $"/api/users/{id}", input with { Enabled = false, Password = null })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/auth/me")).StatusCode);
    }
    [Fact]
    public async Task Role_changes_apply_to_next_request_and_client_role_is_not_authoritative()
    {
        var password = "Test-case-only-role-password";
        var input = new UserInput("role-" + Guid.NewGuid().ToString("N"), "角色测试", "13900000003", [Roles.Driver], Password: password);
        var created = await Send(fixture.Clients["admin"], HttpMethod.Post, "/api/users", input); created.EnsureSuccessStatusCode(); var id = (await Json(created)).GetProperty("id").GetInt64();
        using var client = fixture.Factory.CreateClient(); var login = await Json(await Send(client, HttpMethod.Post, "/api/auth/dev-login", new LoginInput(input.Username, password)));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.GetProperty("token").GetString());
        (await client.GetAsync("/api/packaging-types")).EnsureSuccessStatusCode();
        (await Send(fixture.Clients["admin"], HttpMethod.Put, $"/api/users/{id}", input with { Roles = [Roles.Outbound], Password = null })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/packaging-types")).StatusCode);
        login = await Json(await Send(client, HttpMethod.Post, "/api/auth/dev-login", new LoginInput(input.Username, password))); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.GetProperty("token").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/packaging-types?role=ADMIN")).StatusCode);
    }
    [Fact]
    public async Task Multi_role_selection_is_validated_and_remembered_after_relogin()
    {
        var password = "Test-case-multi-role-password";
        var input = new UserInput("multi-" + Guid.NewGuid().ToString("N"), "多角色员工", "13900000004", [Roles.Driver, Roles.Worker], Password: password);
        (await Send(fixture.Clients["admin"], HttpMethod.Post, "/api/users", input)).EnsureSuccessStatusCode();
        using var client = fixture.Factory.CreateClient();
        var login = await Json(await Send(client, HttpMethod.Post, "/api/auth/dev-login", new LoginInput(input.Username, password)));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.GetProperty("token").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, "/api/auth/select-role", new RoleSelectionInput(Roles.Admin))).StatusCode);
        (await Send(client, HttpMethod.Post, "/api/auth/select-role", new RoleSelectionInput(Roles.Worker))).EnsureSuccessStatusCode();
        login = await Json(await Send(client, HttpMethod.Post, "/api/auth/dev-login", new LoginInput(input.Username, password)));
        Assert.Equal(Roles.Worker, login.GetProperty("selectedRole").GetString());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.GetProperty("token").GetString());
        var (packaging, vegetable) = await fixture.Stock();
        var batch = await fixture.Dispatch(packaging);
        (await client.GetAsync($"/api/batches/{batch}/summary")).EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task Failed_login_attempts_are_rate_limited_in_database()
    {
        using var client = fixture.Factory.CreateClient();
        var username = "missing-" + Guid.NewGuid().ToString("N");
        for (var attempt = 0; attempt < 10; attempt++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(client, HttpMethod.Post, "/api/auth/admin-login", new LoginInput(username, "incorrect-password"))).StatusCode);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Send(client, HttpMethod.Post, "/api/auth/admin-login", new LoginInput(username, "incorrect-password"))).StatusCode);
    }
    [Fact]
    public void Production_configuration_refuses_development_login_even_when_explicitly_enabled()
    {
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
        try { Assert.Throws<InvalidOperationException>(AppSettings.Load); }
        finally { Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development"); }
    }
}
