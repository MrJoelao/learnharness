import { Suspense } from "react";
import { ArchivePage } from "@/components/archive-page";

export const dynamic = "force-dynamic";

export default function DedicatedArchivePage() {
	return (
		<Suspense fallback={null}>
			<ArchivePage />
		</Suspense>
	);
}
