import { Router, Request } from "express";
import bcrypt from "bcrypt";
import userRepository from "../repositories/user.repository";
import { UserRole } from "../types";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware";

const router = Router();

// Type helper for session
function getSession(req: Request) {
  return req.session as any;
}

// All user management routes require authentication
router.use(requireAuth);

/**
 * GET /api/users
 * Get all users (admin only)
 */
router.get("/", requireAdmin, async (req, res) => {
  try {
    const users = await userRepository.findAll();
    res.json(users);
  } catch (error: any) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/**
 * POST /api/users
 * Create a new user (admin only)
 */
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res
        .status(400)
        .json({ error: "Email, password, and role are required" });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Validate password strength
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    // Validate role
    if (role !== UserRole.ADMIN && role !== UserRole.USER) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = await userRepository.create({
      email,
      password: hashedPassword,
      role,
      twoFactorSecret: null,
      twoFactorEnabled: 0,
    });

    // Return created user (without password)
    const newUser = await userRepository.findById(userId);
    if (!newUser) {
      return res.status(500).json({ error: "Failed to retrieve created user" });
    }

    res.status(201).json({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
      twoFactorEnabled: newUser.twoFactorEnabled,
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
    });
  } catch (error: any) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

/**
 * PUT /api/users/:id/role
 * Update user role (admin only)
 */
router.put("/:id/role", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role } = req.body;

    if (!role || (role !== UserRole.ADMIN && role !== UserRole.USER)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Don't allow users to change their own role
    const session = getSession(req);
    if (userId === session.user?.id) {
      return res.status(400).json({ error: "Cannot change your own role" });
    }

    // Check if user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update role
    await userRepository.updateRole(userId, role);

    res.json({ message: "User role updated successfully" });
  } catch (error: any) {
    console.error("Error updating user role:", error);
    res.status(500).json({ error: "Failed to update user role" });
  }
});

/**
 * PUT /api/users/:id/password
 * Update user password (admin can update any, users can update their own)
 */
router.put("/:id/password", async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { password } = req.body;

    // Check permission (admin or self)
    const session = getSession(req);
    if (session.user?.role !== UserRole.ADMIN && userId !== session.user?.id) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this user" });
    }

    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    // Validate password strength
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    // Check if user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(password, 10);
    await userRepository.updatePassword(userId, hashedPassword);

    res.json({ message: "Password updated successfully" });
  } catch (error: any) {
    console.error("Error updating password:", error);
    res.status(500).json({ error: "Failed to update password" });
  }
});

/**
 * DELETE /api/users/:id
 * Delete user (admin only)
 */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Don't allow users to delete themselves
    const session = getSession(req);
    if (userId === session.user?.id) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    // Check if user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete user
    await userRepository.delete(userId);

    res.json({ message: "User deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

/**
 * POST /api/users/:id/reset-2fa
 * Reset 2FA for a user (admin only)
 */
router.post("/:id/reset-2fa", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Check if user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Disable 2FA
    await userRepository.disable2FA(userId);

    res.json({ message: "2FA reset successfully" });
  } catch (error: any) {
    console.error("Error resetting 2FA:", error);
    res.status(500).json({ error: "Failed to reset 2FA" });
  }
});

export default router;
