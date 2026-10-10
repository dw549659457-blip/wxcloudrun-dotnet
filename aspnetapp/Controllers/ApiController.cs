using Microsoft.AspNetCore.Mvc;
using aspnetapp.Domain;
using aspnetapp.Services;

namespace aspnetapp.Controllers;

public abstract class ApiController(AuthService authentication) : ControllerBase
{
    protected AuthService Authentication => authentication;
    protected Task<Actor> Current() => authentication.Authenticate(HttpContext);
    protected string Key => Request.Headers["Idempotency-Key"].ToString();
    protected string RequestId => HttpContext.TraceIdentifier;
}
