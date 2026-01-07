import prisma from "../database/prisma";
import { User, UserResponse, UserRole } from "../types";

export class UserRepository {
  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      password: user.password,
      role: user.role as UserRole,
      twoFactorSecret: user.twoFactorSecret ?? null,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    } as any;
  }

  /**
   * Find user by ID
   */
  async findById(id: number): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      password: user.password,
      role: user.role as UserRole,
      twoFactorSecret: user.twoFactorSecret ?? null,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    } as any;
  }

  /**
   * Get all users (excluding passwords)
   */
  async findAll(): Promise<UserResponse[]> {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return users.map((user) => ({
      ...user,
      role: user.role as UserRole,
      twoFactorEnabled: user.twoFactorEnabled === 1,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }));
  }

  /**
   * Create a new user
   */
  async create(
    user: Omit<User, "id" | "createdAt" | "updatedAt">
  ): Promise<number> {
    const created = await prisma.user.create({
      data: {
        email: user.email,
        password: user.password,
        role: user.role,
        twoFactorSecret: user.twoFactorSecret || null,
        twoFactorEnabled: user.twoFactorEnabled ? 1 : 0,
      },
    });

    return created.id;
  }

  /**
   * Update user password
   */
  async updatePassword(id: number, hashedPassword: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Update user role
   */
  async updateRole(id: number, role: UserRole): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: {
        role,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Enable 2FA for user
   */
  async enable2FA(id: number, secret: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: {
        twoFactorSecret: secret,
        twoFactorEnabled: 1,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Disable 2FA for user
   */
  async disable2FA(id: number): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: {
        twoFactorSecret: null,
        twoFactorEnabled: 0,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Set 2FA secret (without enabling)
   */
  async set2FASecret(id: number, secret: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: {
        twoFactorSecret: secret,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Delete user
   */
  async delete(id: number): Promise<void> {
    await prisma.user.delete({
      where: { id },
    });
  }

  /**
   * Count total users
   */
  async count(): Promise<number> {
    return await prisma.user.count();
  }
}

export default new UserRepository();
