<!--
  App — root component. Mounts <CourseShell> inside <MotionRoot>.

  P3 transition: the P1 hello-world card is gone; CourseShell now owns the
  entire visible surface. The payload is consumed via the data store (which
  reads #lb-data at module load); App stays small.

  Why MotionRoot wraps everything?
    It exposes the motion store + sets data-motion on <html> as a side
    effect of mounting. All 11 motion moments downstream depend on that
    attribute being present — wrapping the root keeps the gate strict.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import MotionRoot from "./lib/components/MotionRoot.svelte";
  import CourseShell from "./lib/components/CourseShell.svelte";
  import Toast from "./lib/components/Toast.svelte";
  import { applyFeatureDetectAttributes } from "./lib/util/feature-detect";

  // Slice 12 P1 (R-76, ADR-SC-G1): mirror feature-detect results to <html>
  // as data-* attributes so CSS can branch (data-scroll-timeline=native|fallback).
  onMount(() => {
    applyFeatureDetectAttributes();
  });
</script>

<MotionRoot>
  {#snippet children()}
    <CourseShell />
    <Toast />
  {/snippet}
</MotionRoot>
