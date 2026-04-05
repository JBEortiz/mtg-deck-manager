import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRootUrl = pathToFileURL(`${process.cwd()}${path.sep}`);

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export default undefined;"
    };
  }

  if (specifier.startsWith("@/")) {
    const relativePath = specifier.slice(2);
    const candidatePath = path.join(process.cwd(), relativePath);
    if (path.extname(candidatePath) === "") {
      if (existsSync(`${candidatePath}.ts`)) {
        return defaultResolve(pathToFileURL(`${candidatePath}.ts`).href, context, defaultResolve);
      }
      if (existsSync(path.join(candidatePath, "index.ts"))) {
        return defaultResolve(pathToFileURL(path.join(candidatePath, "index.ts")).href, context, defaultResolve);
      }
    }

    return defaultResolve(new URL(relativePath, repoRootUrl).href, context, defaultResolve);
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && path.extname(specifier) === "" && context.parentURL?.startsWith("file:")) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidatePath = path.resolve(path.dirname(parentPath), specifier);
    if (existsSync(`${candidatePath}.ts`)) {
      return defaultResolve(pathToFileURL(`${candidatePath}.ts`).href, context, defaultResolve);
    }
    if (existsSync(path.join(candidatePath, "index.ts"))) {
      return defaultResolve(pathToFileURL(path.join(candidatePath, "index.ts")).href, context, defaultResolve);
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
