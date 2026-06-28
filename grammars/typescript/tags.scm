;; ContextSliver Tree-sitter query for TypeScript / JavaScript / TSX.
;;
;; Capture convention (see CONTRIBUTING.md):
;;   @name                       — the identifier naming a symbol
;;   @definition.function        — function/method/arrow declaration
;;   @definition.class           — class declaration
;;   @definition.interface       — interface declaration
;;   @definition.type            — type alias / enum
;;   @definition.variable        — top-level / exported variable or constant
;;   @import                     — an import statement (extract specifier + names)
;;
;; NOTE: for `const x = ...` we capture the declarator as @definition.variable and let the
;; extractor inspect the value child to reclassify arrow/function-expression values as
;; functions. This avoids conflicting overlapping patterns in the query (which the query
;; compiler rejects as a structural error).

;; ── Functions ──────────────────────────────────────────────────────────────
(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(method_definition name: (_) @name) @definition.function

;; ── Arrow / const functions ────────────────────────────────────────────────
;; Declared as variable; extractor inspects value to set kind=function when arrow/function.
(lexical_declaration (variable_declarator name: (identifier) @name)) @definition.variable

;; ── Classes ────────────────────────────────────────────────────────────────
;; Heritage clauses (extends/implements) are read directly from the class node in the extractor.
;; (In the TS grammar the class name is a type_identifier, not an identifier.)
(class_declaration name: (type_identifier) @name) @definition.class

;; ── Interfaces ─────────────────────────────────────────────────────────────
(interface_declaration name: (type_identifier) @name) @definition.interface

;; ── Type aliases & enums ───────────────────────────────────────────────────
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.type

;; ── Imports ────────────────────────────────────────────────────────────────
(import_statement) @import
