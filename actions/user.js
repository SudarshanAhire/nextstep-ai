"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { generateAIInsights } from "./dashboard";

export async function updateUser(data) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

   if (!data.industry || data.industry.trim() === "") {
    throw new Error("Industry is required before updating the user.");
  }

  try {
    // First, ensure user exists in database (create if doesn't exist)
    let user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) {
      // User doesn't exist, we need to create them first
      const { currentUser } = await import("@clerk/nextjs/server");
      const clerkUser = await currentUser();
      
      if (!clerkUser) {
        throw new Error("User not authenticated");
      }

      const name = `${clerkUser.firstName} ${clerkUser.lastName}`;
      const email = clerkUser.emailAddresses[0]?.emailAddress;

      try {
        user = await db.user.create({
          data: {
            clerkUserId: userId,
            name,
            imageUrl: clerkUser.imageUrl,
            email,
          },
        });
      } catch (createError) {
        // If user creation fails due to unique constraint, try to fetch it
        if (createError.code === 'P2002') {
          user = await db.user.findUnique({
            where: { clerkUserId: userId },
          });
          
          if (!user) {
            throw new Error("Failed to create or find user");
          }
        } else {
          throw createError;
        }
      }
    }

    // Start a transaction to handle both operations
    const result = await db.$transaction(
      async (tx) => {
        // First check if industry exists
        let industryInsight = await tx.industryInsight.findUnique({
          where: {
            industry: data.industry,
          },
        });

        // If industry doesn't exist, create it with default values
        if (!industryInsight) {
          const insights = await generateAIInsights(data.industry);

          industryInsight = await tx.industryInsight.create({
            data: {
              industry: data.industry,
              ...insights,
              nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });
        }

        // Now update the user
        const updatedUser = await tx.user.update({
          where: {
            id: user.id,
          },
          data: {
            industry: data.industry,
            experience: data.experience,
            bio: data.bio,
            skills: data.skills,
          },
        });

        return { updatedUser, industryInsight };
      },
      {
        timeout: 10000, // default: 5000
      }
    );

    revalidatePath("/");
    return {success: true, ...result};
  } catch (error) {
    console.error("Error updating user and industry:", error.message);
    throw new Error("Failed to update profile: " + error.message);
  }
}

export async function getUserOnboardingStatus() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  try {
    const user = await db.user.findUnique({
      where: {
        clerkUserId: userId,
      },
      select: {
        industry: true,
      },
    });

    if (!user) {
      return {
        isOnboarded: false,
      };
    }

    return {
      isOnboarded: !!user?.industry,
    };
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return {
      isOnboarded: false,
    };
  }
}