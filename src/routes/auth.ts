import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import prisma from "../config/prismaClient";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Create Supabase client
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase configuration. Please check environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Get user profile
router.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  try {
    const userData = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        credits: true,
        imageUrl: true,
        createdAt: true,
      },
    });

    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: userData });
  } catch (error) {
    console.error("Error fetching user profile:", error);

    // Return basic user info even if database fails
    if (req.user) {
      return res.json({
        user: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          credits: 0,
          imageUrl: req.user.image,
        },
      });
    }

    res.status(500).json({ error: "Server error" });
  }
});

// Login user with Supabase - route changed to /signin for consistency
router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Use Supabase authentication
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    if (!data || !data.user || !data.session) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    try {
      // Get or create user in our database
      let dbUser = await prisma.user.findUnique({
        where: { id: data.user.id },
      });

      if (!dbUser) {
        // Create new user
        dbUser = await prisma.user.create({
          data: {
            id: data.user.id,
            email: data.user.email!,
            name: data.user.user_metadata.full_name || "New User",
            imageUrl: data.user.user_metadata.avatar_url || undefined,
            provider: "supabase",
            credits: 5, // Initial free credits
          },
        });
      }

      // Return user info with Supabase token
      res.json({
        token: data.session.access_token,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        user: {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          credits: dbUser.credits,
          imageUrl: dbUser.imageUrl,
          createdAt: dbUser.createdAt,
        },
      });
    } catch (dbError) {
      console.error("Database error during login:", dbError);

      // Still return auth token even if database operations fail
      res.json({
        token: data.session.access_token,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        user: {
          id: data.user.id,
          name: data.user.user_metadata.full_name || "",
          email: data.user.email!,
          credits: 0,
          imageUrl: data.user.user_metadata.avatar_url || "",
        },
      });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Register user with Supabase - route changed to /signup for consistency
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email, and password are required" });
    }

    // Use Supabase to create a new user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
        },
      },
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data || !data.user || !data.session) {
      return res.status(400).json({ error: "Failed to create user" });
    }

    try {
      // Create user in our database
      const dbUser = await prisma.user.create({
        data: {
          id: data.user.id,
          name,
          email,
          provider: "supabase",
          credits: 5, // Give new users 5 free credits
        },
      });

      // Return user info with Supabase token
      res.status(201).json({
        token: data.session.access_token,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        user: {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          credits: dbUser.credits,
          imageUrl: dbUser.imageUrl,
          createdAt: dbUser.createdAt,
        },
      });
    } catch (dbError) {
      console.error("Database error during signup:", dbError);

      // Still return auth token even if database operations fail
      res.status(201).json({
        token: data.session.access_token,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        user: {
          id: data.user.id,
          name: name,
          email: email,
          credits: 5,
          imageUrl: data.user.user_metadata.avatar_url || "",
        },
      });
    }
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;