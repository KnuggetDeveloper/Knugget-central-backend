import { Router } from "express";
import {
  hashPassword,
  comparePasswords,
  generateTokens,
  generateVerificationToken,
  verifyToken,
} from "../utils/auth";
import prisma from "../config/prismaClient";

const router = Router();

//get user data
router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const userId = decoded.userId;
    const userData = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        imageUrl: true,
        credits: true,
        createdAt: true,
      },
    });
    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(userData);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//signup
router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ error: "User not found" });
    }
    // compare passwords
    const isPasswordValid = await comparePasswords(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // generate tokens
    const { accessToken, refreshToken, expiresAt } = generateTokens(
      user.id,
      user.email
    );

    // update user with refresh token
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        refreshToken,
        lastLogin: new Date(),
      },
    });
    // send response
    res.json({
      token: accessToken,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        imageUrl: user.imageUrl,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Error signing in:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// signup
router.post("/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }
    // hash password
    const hashedPassword = await hashPassword(password);

    //generate verification token
    const verificationToken = generateVerificationToken();

    //create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: hashedPassword,
        verificationToken,
        credits: 10, // Initial free credits
      },
    });
    // generate tokens
    const { accessToken, refreshToken, expiresAt } = generateTokens(
      user.id,
      user.email
    );

    // Update user with refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        lastLogin: new Date(),
      },
    });
    // TODO: Send verification email (implement this based on your email provider)
    // sendVerificationEmail(user.email, verificationToken);

    // send response
    res.json({
      token: accessToken,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        imageUrl: user.imageUrl,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Error during signup:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// refresh token
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" });
    }

    // Find user by refresh token
    const user = await prisma.user.findFirst({
      where: { refreshToken },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    // Generate new tokens
    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
    } = generateTokens(user.id, user.email);

    // Update user with new refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
    });

    res.json({
      token: accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        imageUrl: user.imageUrl,
      },
      success: true,
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
