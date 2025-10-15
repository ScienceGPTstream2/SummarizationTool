import os
import toml
from pathlib import Path
from typing import List, Dict
import bcrypt
import jwt
from datetime import datetime, timedelta


class AuthService:
    def __init__(self, users_file: Path):
        self.users_file = users_file
        # Load or initialize TOML data
        if not users_file.exists():
            # Ensure file exists
            users_file.write_text(
                '[whitelist]\nemails = []\n\n[[users]]\nemail = ""\nhash = ""\n'
            )
        self._reload()

        # JWT secret and settings
        self.jwt_secret = os.getenv("JWT_SECRET", "default_jwt_secret")
        self.jwt_algorithm = "HS256"
        # Allow configurable expiration (default 24 hours)
        jwt_expiration_hours = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))
        self.jwt_exp_delta = timedelta(hours=jwt_expiration_hours)

    def _reload(self):
        data = toml.loads(self.users_file.read_text())
        self.whitelist: List[str] = data.get("whitelist", {}).get("emails", [])
        self.users: List[Dict] = data.get("users", [])

    def _save(self):
        data = {"whitelist": {"emails": self.whitelist}, "users": self.users}
        self.users_file.write_text(toml.dumps(data))

    def is_whitelisted(self, email: str) -> bool:
        return email in self.whitelist

    def is_registered(self, email: str) -> bool:
        return any(u.get("email") == email for u in self.users)

    def register_user(self, email: str, password: str) -> None:
        if not self.is_whitelisted(email):
            raise ValueError("Email not whitelisted")
        if self.is_registered(email):
            raise ValueError("User already registered")
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode(
            "utf-8"
        )
        self.users.append({"email": email, "hash": hashed})
        self._save()

    def authenticate_user(self, email: str, password: str) -> str:
        # Returns JWT token if credentials valid
        for u in self.users:
            if u.get("email") == email:
                if bcrypt.checkpw(
                    password.encode("utf-8"), u.get("hash").encode("utf-8")
                ):
                    payload = {
                        "sub": email,
                        "exp": datetime.utcnow() + self.jwt_exp_delta,
                    }
                    token = jwt.encode(
                        payload, self.jwt_secret, algorithm=self.jwt_algorithm
                    )
                    return token
                break
        raise ValueError("Invalid credentials")

    def verify_token(self, token: str) -> Dict:
        try:
            return jwt.decode(token, self.jwt_secret, algorithms=[self.jwt_algorithm])
        except jwt.PyJWTError as e:
            raise ValueError("Invalid token") from e
