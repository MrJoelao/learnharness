import { WorkspaceScreen } from "@/components/workspace-screen";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <WorkspaceScreen workspaceId={id} />;
}
