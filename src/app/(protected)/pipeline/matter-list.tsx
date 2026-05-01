import { Briefcase } from "lucide-react";
import { MatterCard } from "./matter-card";
import type { PipelineMatter } from "./queries";

interface MatterListProps {
  matters: PipelineMatter[];
}

export function MatterList({ matters }: MatterListProps) {
  if (matters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/5">
          <Briefcase className="h-6 w-6 text-primary/40" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-foreground">
          No matters
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No matters found for this stage.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {matters.map((matter) => (
        <MatterCard
          key={matter.id}
          id={matter.id}
          contactName={matter.contactName}
          stageName={matter.stageName}
          fee={matter.fee}
          slaColor={matter.slaColor}
          updatedAt={matter.updatedAt}
        />
      ))}
    </div>
  );
}
