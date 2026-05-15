"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { importLeadsCsv } from "./actions";

interface CsvImportDialogProps {
  /** Override the trigger element. Must be a single React element since
   *  base-ui's Dialog.Trigger uses `render` to merge handlers onto it. */
  trigger?: React.ReactElement;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  listName: string;
}

export function CsvImportDialog({ trigger }: CsvImportDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setListName("");
    setCsvText("");
    setFileName(null);
    setError(null);
    setResult(null);
  }

  function handleFile(file: File) {
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      setFileName(file.name);
    };
    reader.onerror = () => setError("Failed to read file");
    reader.readAsText(file);
  }

  function handleSubmit() {
    setError(null);
    if (!listName.trim()) {
      setError("Give this list a name first");
      return;
    }
    if (!csvText.trim()) {
      setError("Pick a CSV file first");
      return;
    }

    const fd = new FormData();
    fd.set("listName", listName.trim());
    fd.set("csvText", csvText);

    startTransition(async () => {
      try {
        const r = await importLeadsCsv(fd);
        setResult(r);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
      }
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline" className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </Button>
          )
        }
      />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            Import leads from CSV
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <ResultView
            result={result}
            onDone={() => handleOpenChange(false)}
            onAnother={reset}
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="listName" className="text-sm">
                List name
              </Label>
              <Input
                id="listName"
                placeholder='e.g. "LegalMatch Q1 2026" or "Trade show booth"'
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                disabled={isPending}
              />
              <p className="text-[11px] text-muted-foreground">
                Every lead from this import will be tagged with this name so
                you can tell where it came from later.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">CSV file</Label>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-md border-2 border-dashed px-3 py-4 transition-colors ${
                  fileName
                    ? "border-primary/40 bg-primary/5"
                    : "border-muted-foreground/30 hover:border-primary/30 hover:bg-muted/30"
                }`}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm">
                  {fileName ?? "Click to choose a .csv file"}
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={isPending}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
              <p className="text-[11px] text-muted-foreground">
                Expected columns (header row required, any subset works):{" "}
                <span className="font-mono">
                  name, email, phone, state, city, matter, description
                </span>
                . Each row must have email or phone.
              </p>
            </div>

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSubmit}
                disabled={isPending || !listName.trim() || !csvText.trim()}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                {isPending ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultView({
  result,
  onDone,
  onAnother,
}: {
  result: ImportResult;
  onDone: () => void;
  onAnother: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          Imported {result.imported} lead{result.imported === 1 ? "" : "s"}
          {" "}into &ldquo;{result.listName}&rdquo;
        </p>
        {result.skipped > 0 && (
          <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-400/80">
            Skipped {result.skipped} already-existing contact
            {result.skipped === 1 ? "" : "s"} (matched on email or phone).
          </p>
        )}
      </div>

      {result.errors.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {result.errors.length} row{result.errors.length === 1 ? "" : "s"}{" "}
            had issues:
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-700 dark:text-amber-400">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAnother}>
          Import another
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
