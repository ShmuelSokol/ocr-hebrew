import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

export async function GET(
  req: NextRequest,
  { params }: { params: { profileId: string; exampleId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const userId = (session.user as { id: string }).id;
  const profile = await prisma.handwritingProfile.findFirst({
    where: { id: params.profileId, userId },
  });
  if (!profile) return new NextResponse("Not found", { status: 404 });

  const example = await prisma.trainingExample.findFirst({
    where: { id: params.exampleId, profileId: params.profileId },
  });
  if (!example) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(example.storagePath);

  if (error || !data) return new NextResponse("File not found", { status: 404 });

  const buffer = Buffer.from(await data.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
