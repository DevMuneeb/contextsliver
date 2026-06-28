;; ContextSliver Tree-sitter query for Python.
;; Same capture convention as grammars/typescript/tags.scm (see CONTRIBUTING.md).

;; ── Functions ──────────────────────────────────────────────────────────────
(function_definition name: (identifier) @name) @definition.function

;; ── Classes ────────────────────────────────────────────────────────────────
;; Capture base classes for inheritance edges (arguments of the class).
(class_definition
  name: (identifier) @name
  (argument_list (identifier) @extends)?) @definition.class

;; ── Imports ────────────────────────────────────────────────────────────────
;; import X / import X as Y / from M import a, b
(import_statement) @import
(import_from_statement) @import
