declare module "express-session" {
  interface SessionData {
    user?: {
      id: number;
      email: string;
      role: string;
      twoFactorEnabled: boolean;
      createdAt: string;
      updatedAt: string;
    };
    pendingEmail?: string;
  }
}
