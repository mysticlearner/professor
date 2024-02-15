import { prismadb } from "@/lib/prismadb";
import { UserMeta, UserThread } from "@prisma/client";
import axios from "axios";
import { NextResponse } from "next/server";
import OpenAI from "openai";

interface UserThreadMap {
  [userId: string]: UserThread;
}

interface UserMetaMap {
  [userId: string]: UserMeta;
}

export async function POST(request: Request) {
  // Validation
  const body = await request.json();

  const { challengeId, secret } = body;

  if (!challengeId || !secret) {
    return NextResponse.json(
      { success: false, message: "Missing required fields" },
      {
        status: 400,
      }
    );
  }

  if (secret !== process.env.APP_SECRET_KEY) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      {
        status: 401,
      }
    );
  }

  // Define work out message prompt
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `
      Generate an ultra-intense, spiritually empowering motivational message followed by a concise, no-equipment-needed yoga and meditation plan. Take into account the user's desired spiritual goals and the time of day provided. This output should strictly contain two parts: first, a motivational message in the style of a spiritual warrior. The message must be direct, powerful, and inspiring. The second part should be a yoga and meditation plan that includes postures and techniques to be completed within 10 minutes. The output must only include these two components, nothing else.

      Here's an example output that you should follow:
      
      It's time to awaken the spiritual warrior within! Leave behind all doubts and distractions. Embrace your inner strength and push beyond your limits. Stay aligned, stay focused, and dive deep into the realm of consciousness. This is your sacred journey, and you are the torchbearer. Let's make every breath count!
      
      - Begin with 5 minutes of deep breathing, inhaling positivity, and exhaling negativity.
      - Flow through 5 rounds of Sun Salutations, connecting with the divine energy of the sun.
      - Hold Warrior II pose for 1 minute on each side, grounding yourself in strength and stability.
      - Embrace the stillness of a 2-minute seated meditation, allowing your mind to settle and your spirit to soar.
      
      Constraints:
      
      The assistant must provide a motivational message in the style of a spiritual warrior, emphasizing strength, focus, and dedication.
      The assistant must provide a concise yoga and meditation plan that can be completed within 10 minutes, focusing on intense postures and techniques.
      The output must strictly contain only the motivational message and the yoga and meditation plan, and no additional information or components.
        `,
    },
    {
      role: "user",
      content: `Generate a new Mystic Learner advice to full fill the task. Remember, only respond in the format specifed earlier. Nothing else`,
    },
  ];

  //  Use OpenAI to generate work out
  const {
    data: { message, success },
  } = await axios.post<{ message?: string; success: boolean }>(
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/openai`,
    {
      messages,
      secret: process.env.APP_SECRET_KEY,
    }
  );

  if (!message || !success) {
    return NextResponse.json(
      {
        success: false,
        message: "Something went wrong with generate openai response",
      },
      {
        status: 500,
      }
    );
  }

  console.log(message);

  // Grab all challenge preferences
  const challengePreferences = await prismadb.challengePreferences.findMany({
    where: {
      challengeId,
    },
  });

  console.log("challengePreferences", challengePreferences);

  const userIds = challengePreferences.map((cp) => cp.userId);

  console.log("userIds", userIds);

  //  Grab all user threads
  const userThreads = await prismadb.userThread.findMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });

  console.log("userThreads", userThreads);

  // Grab all user metadata
  const userMetas = await prismadb.userMeta.findMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });

  console.log("userMetas", userMetas);

  const userThreadMap: UserThreadMap = userThreads.reduce((map, thread) => {
    map[thread.userId] = thread;
    return map;
  }, {} as UserThreadMap);

  const userMetaMap = userMetas.reduce((map, meta) => {
    map[meta.userId] = meta;
    return map;
  }, {} as UserMetaMap);

  // Add messages to threads
  const threadAndNotificationsPromises: Promise<any>[] = [];

  try {
    challengePreferences.forEach((cp) => {
      //  FIND THE RESPECTIVE USER
      const userThread = userThreadMap[cp.userId];

      //  ADD MESSAGE TO THREAD
      if (userThread) {
        // Send Message
        threadAndNotificationsPromises.push(
          axios.post(`${process.env.NEXT_PUBLIC_BASE_URL}/api/message/create`, {
            message,
            threadId: userThread.threadId,
            fromUser: "false",
          })
        );

        // Send Notification
        if (cp.sendNotifications) {
          const correspondingUserMeta = userMetaMap[cp.userId];
          threadAndNotificationsPromises.push(
            axios.post(
              `${process.env.NEXT_PUBLIC_BASE_URL}/api/send-notifications`,
              {
                subscription: {
                  endpoint: correspondingUserMeta.endpoint,
                  keys: {
                    auth: correspondingUserMeta.auth,
                    p256dh: correspondingUserMeta.p256dh,
                  },
                },
                message,
              }
            )
          );
        }
      }
    });

    await Promise.all(threadAndNotificationsPromises);

    return NextResponse.json({ message }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      {
        status: 500,
      }
    );
  }
}
