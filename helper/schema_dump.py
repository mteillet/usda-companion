#!/usr/bin/env python
# Dumps the live USD schema registry (concrete typed schemas + single-apply
# applied API schemas) as JSON, wrapped in sentinels so the extension can ignore
# any interpreter startup noise. Run via the configured python (e.g. hython):
#   hython schema_dump.py [extra generatedSchema.usda paths ...]
import sys, json

BEGIN = "===USDA_SCHEMA_BEGIN==="
END = "===USDA_SCHEMA_END==="
DOC_CAP = 600


def main():
    try:
        from pxr import Usd, Tf, Sdf
    except Exception as e:  # pragma: no cover
        sys.stdout.write(BEGIN + "\n" + json.dumps({"error": "no pxr: %s" % e}) + "\n" + END + "\n")
        return

    reg = Usd.SchemaRegistry()

    def trim(s):
        s = (s or "").strip()
        return s[:DOC_CAP]

    def props_of(prim_def):
        out = []
        try:
            names = prim_def.GetPropertyNames()
        except Exception:
            return out
        for p in names:
            try:
                st = prim_def.GetSpecType(p)
            except Exception:
                continue
            is_attr = st == Sdf.SpecTypeAttribute
            type_name = None
            allowed = None
            if is_attr:
                try:
                    spec = prim_def.GetSchemaPropertySpec(p)
                    type_name = str(spec.typeName) if spec is not None else None
                except Exception:
                    type_name = None
                try:
                    a = prim_def.GetPropertyMetadata(p, "allowedTokens")
                    allowed = [str(t) for t in a] if a else None
                except Exception:
                    allowed = None
            doc = ""
            try:
                doc = prim_def.GetPropertyDocumentation(p) or ""
            except Exception:
                pass
            out.append({
                "name": p,
                "kind": "attr" if is_attr else "rel",
                "type": type_name,
                "allowed": allowed,
                "doc": trim(doc),
            })
        return out

    concrete = {}
    typed_base = Tf.Type.FindByName("UsdTyped")
    if typed_base:
        for t in typed_base.GetAllDerivedTypes():
            name = reg.GetSchemaTypeName(t)
            if not name or not reg.IsConcrete(t):
                continue
            pd = reg.FindConcretePrimDefinition(name)
            if pd is None:
                continue
            concrete[name] = {"doc": trim(pd.GetDocumentation()), "props": props_of(pd)}

    applied = {}
    api_base = Tf.Type.FindByName("UsdAPISchemaBase")
    if api_base:
        for t in api_base.GetAllDerivedTypes():
            name = reg.GetSchemaTypeName(t)
            if not name or not reg.IsAppliedAPISchema(t):
                continue
            pd = reg.FindAppliedAPIPrimDefinition(name)
            if pd is None:
                continue
            applied[name] = {
                "doc": trim(pd.GetDocumentation()),
                "props": props_of(pd),
                "multipleApply": bool(reg.IsMultipleApplyAPISchema(t)),
            }

    payload = {
        "version": list(Usd.GetVersion()),
        "concrete": concrete,
        "applied": applied,
    }
    sys.stdout.write(BEGIN + "\n" + json.dumps(payload) + "\n" + END + "\n")


if __name__ == "__main__":
    main()
