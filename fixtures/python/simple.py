"""Fixture: basic functions + class + imports, for the Python parser golden test."""
from typing import List
from .token_service import TokenService


class User:
    def __init__(self, name: str):
        self.name = name


class AuthService:
    """Auth service depending on TokenService."""

    def __init__(self, tokens: TokenService):
        self.tokens = tokens

    def login(self, user: User) -> str:
        return self.tokens.issue(user)

    def logout(self, token: str) -> None:
        self.tokens.revoke(token)


def create_auth_service(t: TokenService) -> AuthService:
    return AuthService(t)


DEFAULT_TIMEOUT = 5000
