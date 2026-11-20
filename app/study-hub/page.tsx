"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StudyHubCatalog } from "@/components/study-hub-catalog";
import { useGeneralSettings } from "@/components/settings/general-settings";

export const dynamic = "force-dynamic";

export default function StudyHubPage() {
	const router = useRouter();
	const { studyHub } = useGeneralSettings();

	useEffect(() => {
		if (studyHub === false) {
			router.replace("/");
		}
	}, [studyHub, router]);

	if (studyHub === false) return null;

	return <StudyHubCatalog />;
}
