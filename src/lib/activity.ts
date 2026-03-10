import { prisma } from "./prisma";

/** Fire-and-forget: update user's last seen time and action */
export function trackActivity(userId: string, action: string) {
  prisma.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date(), lastAction: action },
  }).catch(() => {}); // Non-blocking, ignore errors
}
