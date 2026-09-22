# Multi-block abstractions visible in real projects

These are excerpts from the full [MistWeather](mistweather.patch), [Mario Bros Commercial Remake](mario-bros-commercial.patch), and [Multiplayer Template](multiplayer-template.patch) patches. `-` is source from baseline commit `8d01efa`; `+` is source from this branch, generated from the same SB3 file.

## A timed costume loop in Mario Bros Commercial Remake

```diff
 when flag at 18,86 {
   hide;
-  forever {
-    wait 0.03;
+  every 0.03 seconds {
     nextCostume;
   }
 }
```

The `every` statement expands to the same `control_forever` block with a leading `control_wait`. A zero-second wait stays visible as `forever { wait 0; ... }`.

## Weather text in MistWeather

```diff
-    text.setText(TEXT: temperature ++ "°" ++ temp_unit);
+    text.setText(TEXT: `${temperature}°${temp_unit}`);
```

```diff
-  weather_req_get = fetch.get(URL: "https://api.weather.gov/points/" ++ latitude ++ "," ++ longitude);
+  weather_req_get = fetch.get(URL: `https://api.weather.gov/points/${latitude},${longitude}`);
```

The template prints the same left-associated `operator_join` chain. Its first interpolation does not introduce an extra empty-string join.

## Connection messages in Multiplayer Template

```diff
-      g1nxIrisText.addLine(TEXT: "Error type: " ++ cloudlink.returnStatusCode());
+      g1nxIrisText.addLine(TEXT: `Error type: ${cloudlink.returnStatusCode()}`);
```

Its extension call, `when` hats, broadcasts, and stop commands retain their original spelling.

## Other compound patterns to consider

| Project evidence | Possible abstraction | Required exact-match rule |
| --- | --- | --- |
| Mario Bros has `repeat 6 { costume "12"; wait 0.2; costume "13"; wait 0.2; }` | An `animate` or frame-sequence form | Each frame must be a costume switch followed by a wait; preserve order, duration, menu shadow data, and comments |
| Multiplayer Template repeats error branches ending in `stop all;` | A guard/abort form | Match the complete conditional and its stop block; leave branches with additional exits or attached comments alone |
| MistWeather checks an empty response after each fetch | A retry/response-chain form | Match the full nested control tree; keep every fetch, assignment, and branch in its original order |

These are candidates, not emitted syntax. They would shorten sequences of Scratch blocks. Changing individual command names or flattening a control tree without an exact inverse would not meet the round-trip requirement.
