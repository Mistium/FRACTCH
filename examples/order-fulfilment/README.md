# Order fulfilment example

The [Scratch project](../order-fulfilment.sb3) is built from
[Stage/main.fractch](Stage/main.fractch). It walks a list of order numbers,
copies nonempty orders to a dispatch list, and reports progress.

```fractch
for (position, order) in orders {
  ready.push(order);
  say `Packed ${order} (${position}/${orders.length})`;
}
```

The same loop appears in the `.sb3` as a list length reporter, a
`control_for_each` loop, and an item lookup. A Scratch block comment contains
the shorter snippet. To rebuild the project, run
`fractch examples/order-fulfilment.sb3 from examples/order-fulfilment`.
