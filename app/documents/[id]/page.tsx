import { auth } from "@/auth";
import { redirect } from "next/navigation";
import EditorWorkspace from "@/components/editor/EditorWorkspace";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentPage(props: PageProps) {
  // Await the asynchronous params in Next.js 16
  const params = await props.params;
  const { id: documentId } = params;

  // Protect route server-side
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/documents/${documentId}`);
  }

  return <EditorWorkspace documentId={documentId} />;
}
