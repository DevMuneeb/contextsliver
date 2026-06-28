// Fixture: basic class + function + interface + imports.
// The golden file expected/simple.json is the source of truth for extractor output.
import { User } from '../users/User';
import { TokenService } from './TokenService';

export interface AuthConfig {
  timeout: number;
}

export class AuthService {
  constructor(private tokens: TokenService) {}

  login(user: User): string {
    return this.tokens.issue(user);
  }

  logout(token: string): void {
    this.tokens.revoke(token);
  }
}

export function createAuthService(t: TokenService): AuthService {
  return new AuthService(t);
}

export const DEFAULT_TIMEOUT = 5000;
export const handler = (req: unknown) => null;

type Token = string;
