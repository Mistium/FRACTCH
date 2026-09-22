# Multi-block abstractions

Fractch keeps the existing Scratch-style command names. These forms shorten **patterns of several blocks**. The source generator uses them only when it recognizes the complete shape; other block trees retain the usual commands and generic opcode calls.

## Iterate through a list

```fractch
for order in orders using position {
  append(ready, order);
  say `Packed ${order} (${position})`;
}
```

`orders` must be a declared list. Packing creates a `control_for_each` counter from 1 to the list's `data_lengthoflist`, then assigns `data_itemoflist(orders, position)` to `order` at the start of every iteration. Omit `using position` when the index is unused; Fractch creates a hidden counter variable. A scalar `for i in count` keeps its original meaning.

The [order fulfilment example](../examples/order-fulfilment/README.md) includes the actual SB3 and a matching Fractch source file.

## Timed forever loop

```fractch
every 0.03 seconds {
  nextCostume;
}
```

This expands to `forever { wait 0.03; nextCostume; }`. The source generator emits `every` only when the `wait` block is first in the loop, has a normal duration input, and has no attached comment. A literal zero-second wait stays `forever { wait 0; ... }`, which makes the frame-yielding wait visible.

## String join chain

```fractch
say `Score: ${score}`;
text.setText(TEXT: `${temperature}°${unit}`);
```

The first segment becomes the first input; each later segment adds one `operator_join` block to a left-associated chain. A template can start with an expression. The generator falls back to `++` when a template would merge two distinct literal joins, lose an empty string input, or hide a nonstandard block field. It escapes literal backticks, backslashes, and `${` markers.

The [real MistWarp project patches](../examples/mistwarp-diffs/README.md) show timed loops and join chains before and after this change. All Scratch command calls in those patches keep their original names.
