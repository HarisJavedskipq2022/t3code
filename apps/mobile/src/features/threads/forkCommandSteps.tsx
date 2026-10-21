import {
  commandOutputFilters,
  displayCommandSteps,
  formatTestSummary,
  parseTestSummary,
  splitCommandSteps,
  type CommandStep,
} from "@t3tools/client-runtime/work-log/fork-command-steps";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

// A step longer than this, usually an inline script, shows its first CLAMPED_LINES lines.
const LONG_STEP_LINES = 12;
const CLAMPED_LINES = 8;
// One setup step reads fine inline; folding pays off from two.
const FOLD_SETUP_FROM = 2;

function StepText(props: { readonly step: CommandStep }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = props.step.text.split("\n").length;
  const long = lineCount > LONG_STEP_LINES;
  // `&&` and `;` read as "then"; `||` and `&` change what the step means, so they stay visible.
  const joiner = props.step.joiner === "||" || props.step.joiner === "&" ? props.step.joiner : null;
  return (
    <View>
      <Text
        selectable
        numberOfLines={long && !expanded ? CLAMPED_LINES : undefined}
        className="font-mono text-2xs leading-normal text-foreground"
      >
        {joiner ? <Text className="text-foreground-subtle">{`${joiner} `}</Text> : null}
        {props.step.text}
      </Text>
      {long ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}>
          <Text className="text-3xs text-foreground-muted">
            {expanded ? "Show less" : `Show all ${lineCount} lines`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * An expanded command as its steps: a leading `cd` becomes the folder it runs
 * in, and setup that leads up to the work folds into one line.
 */
export function ForkCommandSteps(props: {
  readonly command: string;
  readonly workspaceRoot?: string | null | undefined;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const { location, steps, setupCount } = displayCommandSteps(props.command, props.workspaceRoot);
  const foldable = setupCount >= FOLD_SETUP_FROM;
  const shown = foldable && !showSetup ? steps.slice(setupCount) : steps;
  return (
    <View className="gap-0.5">
      {location !== "" ? (
        <Text
          numberOfLines={1}
          className="font-mono text-2xs leading-normal text-foreground-subtle"
        >
          {`in ${location}`}
        </Text>
      ) : null}
      {foldable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showSetup }}
          onPress={() => setShowSetup(!showSetup)}
        >
          <Text className="font-mono text-2xs leading-normal text-foreground-subtle">
            {`${showSetup ? "▾" : "▸"} ${setupCount === 1 ? "1 setup step" : `${setupCount} setup steps`}`}
          </Text>
        </Pressable>
      ) : null}
      {shown.map((step, index) => (
        // Steps come from a fixed string and never reorder.
        // oxlint-disable-next-line react/no-array-index-key
        <StepText key={index} step={step} />
      ))}
    </View>
  );
}

/**
 * A test runner's pass and fail counts and a note when a pipe cut the output.
 * A run piped through `head` exits 0 even when tests failed, so the counts are the status.
 */
export function ForkCommandOutputSummary(props: {
  readonly command: string;
  readonly output: string | null;
}) {
  const summary = props.output ? parseTestSummary(props.output) : null;
  const filters = commandOutputFilters(splitCommandSteps(props.command));
  if (summary === null && filters.length === 0) return null;
  return (
    <View className="mt-1.5 gap-0.5">
      {summary !== null ? (
        <Text
          className={cn(
            "rounded-md px-2 py-1 font-mono text-2xs",
            summary.failed > 0
              ? "bg-danger text-danger-foreground"
              : "bg-secondary text-foreground-muted",
          )}
        >
          {formatTestSummary(summary)}
        </Text>
      ) : null}
      {filters.length > 0 ? (
        <Text className="text-3xs text-foreground-subtle">
          {`Output piped through ${filters.join(", ")}`}
        </Text>
      ) : null}
    </View>
  );
}
