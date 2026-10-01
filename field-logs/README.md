# Field-test logs

Exported diagnostic logs from real drives. **This directory is gitignored and
the repository is public.** Nothing in here is ever committed.

## Why it is ignored

An exported log carries, in plain text:

- speech captured in the cabin, including anyone else who was present
- Bluetooth device labels, which routinely contain a person's name
- the phone's OS and browser version, and the app URL
- profile names with their rules, stake sizes and starting bankroll
- timestamps showing when, and for how long, the device was being driven

The ignore is on the whole directory rather than a `*.log` glob, so a log saved
under any name or extension is covered. Check before adding anything here:

```sh
git check-ignore -v field-logs/whatever-you-just-saved
```

## Naming

`YYYY-MM-DD-<condition-id>.log`, e.g. `2026-09-30-drill-freeway.log`. The
condition id is the one in `src/diag/fieldTest.ts`, so a log can be read back
against the protocol that produced it.

## Reading one

The header states the entry count, the page loads, the body-clock offset and
the first/last timestamps. Body-clock time is local; `first`/`last` are UTC.
Lines are in true order even where the recorded times are not — a clock that
moved mid-run is noted in the header.

What to read first on a drill leg:

- `said=` against the `answer=` on each word step — the intelligibility rate
- every `echo` step: whether a word came back at all, and `echoTook=`
- `echo-after-voice` against `echo-forward` — same press, same page load, the
  microphone opened in between
- `sweep-reading` per input — the car's microphone against the phone's under
  one noise level
- `wheel-not-pressed`, wherever it appears
- `focus lapsed` and any `handled=false`, which is the wheel going dead
