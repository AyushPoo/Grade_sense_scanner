from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional


class GoogleInviteAuthError(RuntimeError):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class GoogleProfile:
    email: str
    name: str
    picture_url: str = ""
    subject: str = ""


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def display_name_for(profile: GoogleProfile, invite_name: Optional[str] = None) -> str:
    name = (profile.name or "").strip() or (invite_name or "").strip()
    if name:
        return name
    return normalize_email(profile.email).split("@")[0] or "Teacher"


def utc_now_text() -> str:
    return datetime.now(timezone.utc).isoformat()


async def resolve_or_claim_teacher_invite(
    conn: Any,
    profile: GoogleProfile,
    *,
    id_factory: Callable[[], str],
    now_factory: Callable[[], str] = utc_now_text,
) -> dict[str, Any]:
    """
    Return an active webapp user for a Google-authenticated email.

    If the email does not have a user row yet, a pending teacher invitation is
    enough authority to create an active teacher user and mark the invite
    accepted. This lets invited teachers sign into the mobile app first.
    """
    email = normalize_email(profile.email)
    if not email:
        raise GoogleInviteAuthError(401, "Google token missing email")

    async with conn.transaction():
        existing_user = await conn.fetchrow(
            """
            SELECT id, email, name, role, account_status, picture_url
            FROM users
            WHERE lower(email) = $1
            ORDER BY created_at ASC
            LIMIT 1
            """,
            email,
        )

        if existing_user:
            user = dict(existing_user)
            if user.get("account_status") != "active":
                raise GoogleInviteAuthError(403, "Account is not active")

            now = now_factory()
            await conn.execute(
                """
                UPDATE users
                SET name = COALESCE(NULLIF($2, ''), name),
                    picture_url = COALESCE(NULLIF($3, ''), picture_url),
                    google_subject = COALESCE(NULLIF($4, ''), google_subject),
                    last_login_at = $5,
                    updated_at = $5
                WHERE id = $1
                """,
                user["id"],
                (profile.name or "").strip(),
                (profile.picture_url or "").strip(),
                (profile.subject or "").strip(),
                now,
            )
            await accept_pending_teacher_invite(conn, email, user["id"], now)
            return {
                **user,
                "email": email,
                "name": display_name_for(profile, user.get("name")),
                "picture_url": (profile.picture_url or user.get("picture_url") or ""),
            }

        invite = await conn.fetchrow(
            """
            SELECT id, email, name
            FROM teacher_invitations
            WHERE lower(email) = $1
              AND status = 'pending'
              AND CASE
                    WHEN expires_at IS NULL OR expires_at = '' THEN true
                    ELSE expires_at::timestamptz > now()
                  END
            ORDER BY created_at ASC
            FOR UPDATE
            LIMIT 1
            """,
            email,
        )

        if not invite:
            raise GoogleInviteAuthError(
                403,
                "This email has not been invited to GradeSense. Ask your administrator to invite this exact Google email.",
            )

        invite = dict(invite)
        user_id = id_factory()
        now = now_factory()
        user_name = display_name_for(profile, invite.get("name"))
        picture_url = (profile.picture_url or "").strip()
        google_subject = (profile.subject or "").strip()

        await conn.execute(
            """
            INSERT INTO users (
                id, email, name, role, picture_url, account_status,
                profile_completed, google_subject, last_login_at, created_at, updated_at
            )
            VALUES ($1, $2, $3, 'teacher', NULLIF($4, ''), 'active',
                    false, NULLIF($5, ''), $6, $6, $6)
            """,
            user_id,
            email,
            user_name,
            picture_url,
            google_subject,
            now,
        )

        await conn.execute(
            """
            UPDATE teacher_invitations
            SET status = 'accepted',
                accepted_by_user_id = $2,
                accepted_at = $3,
                updated_at = $3
            WHERE id = $1
            """,
            invite["id"],
            user_id,
            now,
        )

        return {
            "id": user_id,
            "email": email,
            "name": user_name,
            "role": "teacher",
            "account_status": "active",
            "picture_url": picture_url,
        }


async def accept_pending_teacher_invite(conn: Any, email: str, user_id: str, now: str) -> None:
    await conn.execute(
        """
        UPDATE teacher_invitations
        SET status = 'accepted',
            accepted_by_user_id = $2,
            accepted_at = $3,
            updated_at = $3
        WHERE id = (
            SELECT id
            FROM teacher_invitations
            WHERE lower(email) = $1
              AND status = 'pending'
              AND CASE
                    WHEN expires_at IS NULL OR expires_at = '' THEN true
                    ELSE expires_at::timestamptz > now()
                  END
            ORDER BY created_at ASC
            FOR UPDATE
            LIMIT 1
        )
        """,
        normalize_email(email),
        user_id,
        now,
    )
