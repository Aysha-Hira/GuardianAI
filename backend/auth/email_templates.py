from __future__ import annotations

from html import escape

C_BG = "#080a0f"
C_CARD = "#0e1118"
C_INPUT = "#080a0f"
C_SURFACE = "#131820"
C_BORDER = "#2a3142"
C_BORDER_LIGHT = "#3d4659"
C_TEXT = "#ffffff"
C_SUB = "#a8b4c4"
C_LABEL = "#d1d9e6"
C_MUTED = "#8b97a8"
C_ACCENT = "#34d399"
C_ACCENT_BORDER = "#34d399"
C_INFO = "#60a5fa"
C_WARNING = "#fbbf24"


def _cell_bg(color: str) -> str:
    return f"background-color:{color};"


def _styles() -> str:
    return """
  <style type="text/css">
    body { margin: 0; padding: 0; }
    table { border-collapse: collapse; }
    a { color: #34d399; }
    .force-white { color: #ffffff !important; }
    .force-accent { color: #34d399 !important; }
    .force-sub { color: #a8b4c4 !important; }
    .force-muted { color: #8b97a8 !important; }
  </style>
"""


def _base_shell(*, preheader: str, hero_title: str, hero_subtitle: str, body_html: str, footer_note: str) -> str:
    preheader = escape(preheader)
    hero_title = escape(hero_title)
    hero_subtitle = escape(hero_subtitle)
    footer_note = escape(footer_note)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>{hero_title}</title>
  {_styles()}
</head>
<body bgcolor="{C_BG}" style="margin:0;padding:0;{_cell_bg(C_BG)}">
  <div style="display:none;max-height:0;overflow:hidden;">{preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{C_BG}" style="{_cell_bg(C_BG)}">
    <tr>
      <td align="center" bgcolor="{C_BG}" style="padding:36px 16px;{_cell_bg(C_BG)}">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">
          <tr>
            <td align="center" bgcolor="{C_BG}" style="padding-bottom:22px;{_cell_bg(C_BG)}">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="{C_SURFACE}" style="width:48px;height:48px;border-radius:14px;border:2px solid {C_ACCENT_BORDER};{_cell_bg(C_SURFACE)}font-size:22px;font-weight:700;font-family:Menlo,Monaco,Consolas,monospace;">
                    <font color="{C_ACCENT}"><span style="color:{C_ACCENT};">G</span></font>
                  </td>
                  <td bgcolor="{C_BG}" style="padding-left:12px;{_cell_bg(C_BG)}">
                    <font color="{C_TEXT}"><span style="font-size:19px;font-weight:700;color:{C_TEXT};">Guardian AI</span></font>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="{C_CARD}" style="border-radius:18px;border:2px solid {C_BORDER};{_cell_bg(C_CARD)}">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{C_CARD}" style="{_cell_bg(C_CARD)}">
                <tr>
                  <td bgcolor="{C_ACCENT}" style="height:4px;font-size:0;line-height:0;{_cell_bg(C_ACCENT)}">&nbsp;</td>
                </tr>
                <tr>
                  <td bgcolor="{C_CARD}" style="padding:28px 24px 24px;{_cell_bg(C_CARD)}">
                    <p style="margin:0 0 8px;">
                      <font color="{C_ACCENT}"><span style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:{C_ACCENT};">Security Operations</span></font>
                    </p>
                    <h1 style="margin:0 0 8px;font-size:23px;line-height:1.25;font-weight:700;">
                      <font color="{C_TEXT}"><span style="color:{C_TEXT};">{hero_title}</span></font>
                    </h1>
                    <p style="margin:0 0 22px;font-size:14px;line-height:1.5;">
                      <font color="{C_SUB}"><span style="color:{C_SUB};">{hero_subtitle}</span></font>
                    </p>
                    {body_html}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" bgcolor="{C_BG}" style="padding:20px 8px 0;{_cell_bg(C_BG)}">
              <p style="margin:0 0 6px;font-size:11px;line-height:1.5;">
                <font color="{C_MUTED}"><span style="color:{C_MUTED};">{footer_note}</span></font>
              </p>
              <p style="margin:0;font-size:10px;">
                <font color="{C_MUTED}"><span style="color:{C_MUTED};">© Guardian AI · Intelligent CCTV monitoring</span></font>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def render_verification_email(*, code: str, verify_url: str, ttl_minutes: int) -> tuple[str, str]:
    digits = list(code.strip()[:6].ljust(6, "0"))
    digit_cells = "".join(
        f"""<td align="center" bgcolor="{C_INPUT}" style="width:44px;height:50px;border-radius:10px;border:2px solid {C_BORDER_LIGHT};{_cell_bg(C_INPUT)}">
          <font color="{C_ACCENT}"><span style="font-family:Menlo,Monaco,Consolas,monospace;font-size:22px;font-weight:700;color:{C_ACCENT};">{escape(d)}</span></font>
        </td>
        <td bgcolor="{C_CARD}" style="width:6px;{_cell_bg(C_CARD)}"></td>"""
        for d in digits
    )

    body_html = f"""
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" bgcolor="{C_CARD}" style="margin:0 auto 16px;{_cell_bg(C_CARD)}">
      <tr>{digit_cells}</tr>
    </table>
    <p style="margin:0 0 18px;text-align:center;">
      <font color="{C_MUTED}"><span style="font-size:12px;color:{C_MUTED};">Expires in {ttl_minutes} minutes</span></font>
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{C_CARD}" style="margin-bottom:18px;{_cell_bg(C_CARD)}">
      <tr>
        <td align="center" bgcolor="{C_CARD}" style="{_cell_bg(C_CARD)}">
          <a href="{escape(verify_url)}" style="display:inline-block;padding:13px 26px;border-radius:10px;border:2px solid {C_ACCENT_BORDER};{_cell_bg(C_SURFACE)}text-decoration:none;">
            <font color="{C_ACCENT}"><span style="font-size:14px;font-weight:700;color:{C_ACCENT};">Verify my account</span></font>
          </a>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{C_INPUT}" style="border-radius:10px;border:2px solid {C_BORDER};{_cell_bg(C_INPUT)}">
      <tr>
        <td bgcolor="{C_INPUT}" style="padding:12px 14px;{_cell_bg(C_INPUT)}">
          <p style="margin:0;font-size:12px;line-height:1.5;">
            <font color="{C_LABEL}"><span style="color:{C_LABEL};"><strong>Didn't sign up?</strong></span></font>
            <font color="{C_SUB}"><span style="color:{C_SUB};"> Ignore this email — no account changes will be made without the code.</span></font>
          </p>
        </td>
      </tr>
    </table>
    """

    plain = (
        f"Your Guardian AI verification code is: {code}\n\n"
        f"Expires in {ttl_minutes} minutes.\n"
        f"Verify at: {verify_url}\n"
    )

    html = _base_shell(
        preheader=f"Your verification code is {code}",
        hero_title="Verify your email",
        hero_subtitle="Enter this code in Guardian AI to activate your operator account and access the operations center.",
        body_html=body_html,
        footer_note="This code was requested for a Guardian AI account. Never share it with anyone.",
    )
    return plain, html


def render_password_reset_email(*, reset_url: str, ttl_minutes: int) -> tuple[str, str]:
    body_html = f"""
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{C_CARD}" style="margin-bottom:20px;{_cell_bg(C_CARD)}">
      <tr>
        <td align="center" bgcolor="{C_CARD}" style="{_cell_bg(C_CARD)}">
          <a href="{escape(reset_url)}" style="display:inline-block;padding:13px 28px;border-radius:10px;border:2px solid {C_ACCENT_BORDER};{_cell_bg(C_SURFACE)}text-decoration:none;">
            <font color="{C_ACCENT}"><span style="font-size:14px;font-weight:700;color:{C_ACCENT};">Reset password</span></font>
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 14px;text-align:center;font-size:12px;line-height:1.55;">
      <font color="{C_MUTED}"><span style="color:{C_MUTED};">Or copy this link:</span></font><br/>
      <a href="{escape(reset_url)}" style="color:{C_INFO};word-break:break-all;">
        <font color="{C_INFO}"><span style="color:{C_INFO};">{escape(reset_url)}</span></font>
      </a>
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{C_INPUT}" style="border-radius:10px;border:2px solid {C_BORDER};{_cell_bg(C_INPUT)}">
      <tr>
        <td bgcolor="{C_INPUT}" style="padding:12px 14px;{_cell_bg(C_INPUT)}">
          <p style="margin:0 0 6px;font-size:12px;line-height:1.5;">
            <font color="{C_WARNING}"><span style="color:{C_WARNING};"><strong>⏱ {ttl_minutes}-minute window</strong></span></font>
            <font color="{C_SUB}"><span style="color:{C_SUB};"> — this link expires for your security.</span></font>
          </p>
          <p style="margin:0;font-size:12px;line-height:1.5;">
            <font color="{C_LABEL}"><span style="color:{C_LABEL};"><strong>Wasn't you?</strong></span></font>
            <font color="{C_SUB}"><span style="color:{C_SUB};"> Ignore this email. Your password stays the same.</span></font>
          </p>
        </td>
      </tr>
    </table>
    """

    plain = (
        f"Reset your Guardian AI password:\n\n{reset_url}\n\n"
        f"Valid for {ttl_minutes} minutes.\n"
    )

    html = _base_shell(
        preheader="Reset your Guardian AI password",
        hero_title="Password reset requested",
        hero_subtitle="We received a request to reset the password for your Guardian AI operator account.",
        body_html=body_html,
        footer_note="If you didn't request a password reset, you can safely ignore this message.",
    )
    return plain, html


def render_signin_code_email(*, code: str, ttl_minutes: int, purpose: str) -> tuple[str, str]:
    digits = list(code.strip()[:6].ljust(6, "0"))
    digit_cells = "".join(
        f"""<td align="center" bgcolor="{C_INPUT}" style="width:44px;height:50px;border-radius:10px;border:2px solid {C_BORDER_LIGHT};{_cell_bg(C_INPUT)}">
          <font color="{C_ACCENT}"><span style="font-family:Menlo,Monaco,Consolas,monospace;font-size:22px;font-weight:700;color:{C_ACCENT};">{escape(d)}</span></font>
        </td>
        <td bgcolor="{C_CARD}" style="width:6px;{_cell_bg(C_CARD)}"></td>"""
        for d in digits
    )
    if purpose == "enable":
        title = "Turn on two-step sign-in"
        subtitle = "Enter this code in Guardian AI Settings to confirm it's your inbox."
        warn = "<strong>Didn't ask for this?</strong> Ignore this email; nothing changes without the code."
    else:
        title = "Your sign-in code"
        subtitle = "Someone (hopefully you) entered your password. Enter this code to finish signing in."
        warn = "<strong>Wasn't you?</strong> Don't share this code, and change your password in Settings."
    body_html = f"""
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" bgcolor="{C_CARD}" style="margin:0 auto 16px;{_cell_bg(C_CARD)}">
      <tr>{digit_cells}</tr>
    </table>
    <p style="margin:0 0 18px;text-align:center;">
      <font color="{C_MUTED}"><span style="font-size:12px;color:{C_MUTED};">Expires in {ttl_minutes} minutes</span></font>
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{C_INPUT}" style="border-radius:10px;border:2px solid {C_BORDER};{_cell_bg(C_INPUT)}">
      <tr><td bgcolor="{C_INPUT}" style="padding:12px 14px;{_cell_bg(C_INPUT)}">
        <p style="margin:0;font-size:12px;line-height:1.5;"><font color="{C_SUB}"><span style="color:{C_SUB};">{warn}</span></font></p>
      </td></tr>
    </table>
    """
    plain = f"{title}\n\nYour Guardian AI code is: {code}\nExpires in {ttl_minutes} minutes.\n"
    html = _base_shell(
        preheader=f"Your Guardian AI code is {code}",
        hero_title=title,
        hero_subtitle=subtitle,
        body_html=body_html,
        footer_note="Guardian AI will never ask you for this code by phone or chat.",
    )
    return plain, html
