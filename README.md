# 生词

Flashcards, a quiz and typing practice for the vocabulary of *Developing Chinese (2nd ed.),
Elementary Comprehensive Course I* (发展汉语 初级综合 I), with spaced repetition.

- **On a phone:** https://lamela11.github.io/chinese-vocab/ — add it to the home screen; it works
  without internet once opened.
- **On the laptop:** double-click `Open vocab app.cmd`.
- **Progress** is synced between devices through a separate private repository,
  `chinese-vocab-progress`, with a key that can only open that one (Sync, in the app).

The word lists are in `units/`: a folder per unit, and `units/my-words/` for **My words**, the words
you add yourself that aren't in the book's units (ids `m1`, `m2`, ...; no Chinese in the English,
which is the front of a card). `tools/vocab.py check` checks them and `tools/vocab.py index`
rebuilds `units/index.json`. Run both after changing a list, then commit and push: the phone shows
new words the next time the app starts, and a change to the app itself the time after that.
