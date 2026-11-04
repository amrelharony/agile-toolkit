"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { planBookImport } from "@/lib/comics/import-book";
import { processPanelImage } from "@/lib/comics/image-pipeline";
import { planConflicts, runImport, type ImportProgress } from "@/lib/comics/import-runner";
import {
  WEEKLY_SCRIPT_FILE,
  findWeeklyScriptFile,
  planWeeklyImport,
  type FolderFile,
  type ImportPlan,
  type ImportStory,
} from "@/lib/comics/import-weekly";
import { OwnerOnlyNotice } from "../comics-portal";
import { createArtUploader, errorMessage, panelForSave, portalApi } from "../portal-api";

type PickedFile = FolderFile & { file: File };

const SIGN_IN_HREF = `/auth/sign-in?next=${encodeURIComponent("/settings/comics/import")}`;

function toPicked(list: FileList | null): PickedFile[] {
  return Array.from(list ?? []).map((file) => ({
    file,
    path: (file.webkitRelativePath || file.name).replace(/\\/g, "/"),
  }));
}

/** A phone can't choose a folder, and an import would flatten its battery anyway. */
function useIsSmallTouchScreen(): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    try {
      setSmall(window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches);
    } catch {
      setSmall(false);
    }
  }, []);
  return small;
}

type Stage =
  | { name: "idle" }
  | { name: "planning" }
  | { name: "refused"; problems: string[] }
  | { name: "ready"; stories: ImportStory<PickedFile>[]; error?: string }
  | { name: "running"; stories: ImportStory<PickedFile>[]; progress: ImportProgress | null }
  | { name: "finished"; stories: ImportStory<PickedFile>[]; progress: ImportProgress };

function ImportCard({
  title,
  intro,
  plan,
  canRun,
}: {
  title: string;
  intro: string;
  plan: (files: PickedFile[]) => Promise<ImportPlan<PickedFile>>;
  canRun: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const stopping = useRef(false);
  const [stopRequested, setStopRequested] = useState(false);

  const pickFolder = async (picked: PickedFile[]) => {
    setStage({ name: "planning" });
    try {
      const result = await plan(picked);
      setStage(
        result.ok
          ? { name: "ready", stories: result.stories }
          : { name: "refused", problems: result.problems }
      );
    } catch (err) {
      setStage({ name: "refused", problems: [errorMessage(err)] });
    }
  };

  const run = async (stories: ImportStory<PickedFile>[]) => {
    stopping.current = false;
    setStopRequested(false);
    setStage({ name: "running", stories, progress: null });
    try {
      const existing = (await portalApi.listStories()).stories;
      const conflicts = planConflicts(stories, existing);
      if (conflicts.length > 0) {
        setStage({
          name: "refused",
          problems: [
            `These numbers already hold other stories: ${conflicts.slice(0, 12).join(", ")}. Nothing was imported.`,
          ],
        });
        return;
      }
      const uploader = createArtUploader();
      const progress = await runImport<PickedFile>({
        plan: stories,
        existing,
        shouldStop: () => stopping.current,
        onProgress: (next) => setStage({ name: "running", stories, progress: next }),
        deps: {
          createStory: async (story) =>
            (
              await portalApi.createStory({
                ep: story.ep,
                sourceId: story.sourceId,
                title: story.title,
                lesson: story.lesson,
                squadQuestion: story.squadQuestion,
                castNames: story.castNames,
                themes: story.themes,
                bookPage: story.bookPage,
                panels: story.panels.map((panel) => panel.text),
              })
            ).story,
          savePanels: async (ep, panels, sharePath) =>
            (await portalApi.patchStory(ep, { panels: panels.map(panelForSave), sharePath })).story,
          release: async (ep) => (await portalApi.setRelease(ep, new Date().toISOString())).story,
          convertAndUpload: (picked, panel, withShare, shareCorner) =>
            processPanelImage(picked.file, {
              corner: panel.creditCorner,
              withShare,
              shareCorner,
              uploader,
            }),
        },
      });
      setStage({ name: "finished", stories, progress });
    } catch (err) {
      // The folder is still good, so a dropped connection only needs another go.
      setStage({ name: "ready", stories, error: errorMessage(err) });
    }
  };

  const progress = stage.name === "running" || stage.name === "finished" ? stage.progress : null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="font-semibold text-text">{title}</h2>
        <p className="text-sm text-sub">{intro}</p>
        <Button asChild variant="outline" className="cursor-pointer focus-within:ring-1">
          <label>
            <FolderOpen aria-hidden="true" />
            Choose the folder
            <input
              type="file"
              multiple
              className="sr-only"
              disabled={stage.name === "running"}
              // Not in React's types, and it has to reach the DOM as an attribute.
              {...({ webkitdirectory: "" } as Record<string, string>)}
              onChange={(e) => {
                const picked = toPicked(e.target.files);
                // Cleared, or choosing the same folder again wouldn't fire this.
                e.target.value = "";
                void pickFolder(picked);
              }}
            />
          </label>
        </Button>

        {stage.name === "planning" ? (
          <p role="status" className="text-sm text-sub">
            Reading the folder…
          </p>
        ) : null}
        {stage.name === "refused" ? (
          <div role="alert" className="text-sm">
            <p className="font-medium text-danger">Can&apos;t import this:</p>
            <ul className="mt-1 list-disc pl-5 text-text">
              {stage.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {stage.name === "ready" ? (
          <div className="space-y-2">
            <p role="status" className="text-sm text-text">
              Found {stage.stories.length} stories and{" "}
              {stage.stories.reduce((sum, s) => sum + s.panels.length, 0)} panels.
            </p>
            {stage.error ? (
              <p role="alert" className="text-sm text-danger">
                {stage.error}
              </p>
            ) : null}
            <Button
              type="button"
              variant="toolkit"
              disabled={!canRun}
              onClick={() => void run(stage.stories)}
            >
              Start the import
            </Button>
          </div>
        ) : null}
        {progress ? (
          <div role="status" className="space-y-1 text-sm text-text">
            <p>
              {progress.storiesDone} of {progress.storiesTotal} stories done, {progress.panelsDone}{" "}
              panels uploaded this run, {progress.skipped} already finished.
            </p>
            {progress.current ? <p className="text-sub">Working on: {progress.current}</p> : null}
          </div>
        ) : null}
        {progress && progress.failures.length > 0 ? (
          <div role="alert" className="text-sm">
            <p className="font-medium text-danger">These stopped partway:</p>
            <ul className="mt-1 list-disc pl-5 text-text">
              {progress.failures.map((f) => (
                <li key={f.ep}>
                  {f.ep}. {f.title}: {f.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {stage.name === "running" ? (
          <Button
            type="button"
            variant="outline"
            disabled={stopRequested}
            onClick={() => {
              stopping.current = true;
              setStopRequested(true);
            }}
          >
            {stopRequested ? "Stopping after this panel…" : "Stop"}
          </Button>
        ) : null}
        {stage.name === "finished" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="toolkit"
              disabled={!canRun}
              onClick={() => void run(stage.stories)}
            >
              Run it again
            </Button>
            <Link className="text-sm text-accent underline" href="/settings/comics">
              Back to the portal, where the review queue is
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function planWeekly(files: PickedFile[]): Promise<ImportPlan<PickedFile>> {
  const scriptFile = findWeeklyScriptFile(files);
  if (!scriptFile) {
    return {
      ok: false,
      problems: [`No editorial/${WEEKLY_SCRIPT_FILE} in this folder.`],
    };
  }
  let scripts: unknown;
  try {
    scripts = JSON.parse(await scriptFile.file.text());
  } catch {
    return { ok: false, problems: [`${WEEKLY_SCRIPT_FILE} couldn't be read as JSON.`] };
  }
  return planWeeklyImport(scripts, files);
}

async function planBook(files: PickedFile[]): Promise<ImportPlan<PickedFile>> {
  return planBookImport(files);
}

export function ImportClient() {
  const { isOwner, visitor } = useOwnerState();
  const small = useIsSmallTouchScreen();

  if (visitor) return <OwnerOnlyNotice href={SIGN_IN_HREF} />;
  if (small) {
    return (
      <p className="max-w-2xl rounded-md border border-border p-4 text-text">
        Imports run on a computer: a phone can&apos;t choose a folder, and this takes a while. Open
        this page on your computer.{" "}
        <Link className="text-accent underline" href="/settings/comics">
          Back to the portal
        </Link>
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      {!isOwner ? (
        <p role="status" className="text-sm text-sub">
          Checking it&apos;s you. The import can start once that finishes.
        </p>
      ) : null}
      <ImportCard
        title="Weekly batch"
        intro={`The folder you extracted all five source volumes into. It reads editorial/${WEEKLY_SCRIPT_FILE} and needs 100 stories and 400 art files. Episodes 27 to 126 arrive as drafts, with nothing scheduled.`}
        plan={planWeekly}
        canRun={isOwner}
      />
      <ImportCard
        title="Book batch"
        intro="The folder scripts/render-book-panels.py made from the finished posters, with Panels/Episode_NN inside it: the poster artwork zip's own files have no lettering. It needs 104 panels. Each arrives with a drafted description for you to approve in the review queue. Printed links show text until an episode's four are approved: then you publish it from the review queue, or a later run that finishes its art publishes it."
        plan={planBook}
        canRun={isOwner}
      />
      <p className="text-sm text-sub">
        Keep this tab open while it runs. Then check the descriptions in the{" "}
        <Link className="text-accent underline" href="/settings/comics">
          portal&apos;s review queue
        </Link>
        .
      </p>
    </div>
  );
}
