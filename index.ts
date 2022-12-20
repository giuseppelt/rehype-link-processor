import type { Root } from "hast";
import { SKIP, visit } from "unist-util-visit";


export type LinkProcessorOptions = {
    /**
     * Sets the processing rules.
     * The processor will execute them in sequence.
     */
    rules?: LinkProcessorRule[]
    /**
     * Disables all builtin rules if set to `false`
     * @defaults true
     */
    useBuiltin?: boolean
}


export type MarkdownLink = {
    href?: string
    title?: string
    text?: string
}

export type LinkAttributes = MarkdownLink & {
    className?: string
    rel?: string
    target?: string
    download?: string | boolean
}

export type Link = LinkAttributes & {
    [key: string]: string | boolean | number | undefined
}

export type LinkTransformer = (link: Link) => Link


type MaybeArray<T> = T | T[];

export type LinkProcessorRule =
    | LinkProcessorBuiltinRule
    | LinkProcessorMatcherRule
    | LinkProcessorTransformerRule

export type LinkProcessorBuiltinRule = keyof typeof BUILTIN;
export type LinkProcessorTransformerRule = (link: MarkdownLink) => Link | false | undefined;
export type LinkProcessorMatcherRule = {
    match(link: Readonly<MarkdownLink>): boolean | Link | undefined
    action: MaybeArray<Readonly<Link> | LinkTransformer>
}


/**
 * Rule action helper
 */
export const A = {
    /**
     * Set the link attribute with the specified value
     */
    set(key: keyof LinkAttributes, value: string | boolean): LinkTransformer {
        return link => {
            link[key] = value as any;
            return link;
        }
    },

    /**
     * Merge the link attribute with the specified value.
     * Useful for space-separated values like class or rel attribute.
     * - if the attribute has no actual value, it will be set with the value
     * - if the attribute has already the same value, it does nothing
     * - otherwise, the value will be merged (_actual_ + " " + _value_)
     */
    merge(key: keyof LinkAttributes, value: string): LinkTransformer {
        return link => {
            const exiting = link[key];
            if (exiting && typeof exiting === "string") {
                link[key] = [...new Set([value, ...exiting.trim().split(" ")])].join(" ");
            } else {
                link[key] = value;
            }
            return link;
        }
    },

    /**
     * Add the specified class to the link
     * If the class is already present, it does nothing
     */
    mergeClass(className: string): LinkTransformer {
        return A.merge("className", className);
    }
};


/**
 * Rule match helpers
 */
export const M = {
    prefix(prefix: string): LinkProcessorMatcherRule["match"] {
        return link => {
            const { href, title, text } = link;

            if (href?.startsWith(prefix)) {
                return { href: href.substring(prefix.length) };
            }

            if (title?.startsWith(prefix)) {
                return { title: title.substring(prefix.length) };
            }

            if (text?.startsWith(prefix)) {
                return { text: text.substring(prefix.length) };
            }
        };
    },

    external(): LinkProcessorMatcherRule["match"] {
        return link => {
            if (link.href?.startsWith("http:") || link.href?.startsWith("https:")) {
                return {};
            }

            return M.prefix("external:")(link);
        };
    },

    download(): LinkProcessorMatcherRule["match"] {
        const PAGE_EXTENSIONS = [
            "html",
            "htm"
        ];

        return link => {
            if (link.href) {
                // check if is a file link
                // check if has an extension, .1-4 char length
                const { pathname } = new URL(link.href, "https://localhost");
                const parts = pathname.split(".");
                if (parts.length >= 2) {
                    const extension = parts.pop()!.toLowerCase();
                    if ((extension.length >= 1 || extension.length <= 4) && !PAGE_EXTENSIONS.includes(extension)) {
                        return { download: pathname.split("/").pop()! };
                    }
                }
            }

            return M.prefix("download:")(link);
        }
    },
}


const BUILTIN = {
    download(): LinkProcessorMatcherRule {
        return {
            match: M.download(),
            action: [
                A.mergeClass("download"),
                link => ({ download: link.download || true })
            ]
        };
    },
    external(): LinkProcessorMatcherRule {
        return {
            match: M.external(),
            action: [
                { target: "_blank", rel: "external nofollow noopener" }, //cspell:disable-line
                A.mergeClass("external")
            ]
        };
    },
    "same-page"(): LinkProcessorMatcherRule {
        return {
            match: link => link.href?.startsWith("#"),
            action: A.mergeClass("same-page")
        };
    }
}

/**
 * Process links with transform rules like adding css classes or custom attributes
 * 
 * @param options Optional configuration with rules to apply
 */
export default function rehypeLinkProcessor(options?: LinkProcessorOptions) {
    const {
        useBuiltin = true,
        rules: designRules = []
    } = options || {};

    if (useBuiltin) {
        const rules = (Object.keys(BUILTIN) as LinkProcessorBuiltinRule[]).filter(x => !designRules.includes(x));
        designRules.push(...rules.map(x => BUILTIN[x]()));
    }


    const rules = designRules.map(rule => {
        // it's a builtin rule --> expand it
        if (typeof rule === "string") {
            const builtin = BUILTIN[rule];
            if (!builtin) {
                throw new Error(`Builtin rule '${rule}' unknown`);
            }

            rule = builtin();
        }

        // it's a matcher rule --> translate it in a transform rule
        if (typeof rule === "object") {
            const { match, action } = rule;
            rule = link => {
                const result = match(link);
                if (!result) return;

                if (typeof result === "object") {
                    link = { ...link, ...result };
                }

                const actions = Array.isArray(action) ? action : [action];

                return actions.reduce((link, action) => {
                    const patch = typeof action === "function"
                        ? action(link)
                        : action;
                    return { ...link, ...patch };
                }, link);
            }
        }

        return rule;
    });

    if (rules.length === 0) {
        console.warn("[rehype-link-processor] no rule active");
        return () => () => { }; // noop
    }


    function processor(link: MarkdownLink): Link | undefined {
        for (const rule of rules) {
            const processed = rule(link);
            if (processed) {
                return processed;
            }
        }
    };


    return () => (tree: Root) => {
        visit(tree, "element", node => {
            if (node.tagName !== "a") return;

            const info: MarkdownLink = {
                href: node.properties?.href as string,
                title: node.properties?.title as string,
                text: node.children?.[0]?.type === "text" ? node.children?.[0]?.value : undefined
            };

            const link = processor(info);

            // apply
            if (!link) {
                return [SKIP];
            }

            const {
                href,
                title,
                text,
                target,
                className,
                download,
                rel,
                ...extra
            } = link;

            node.properties ??= {};

            if (href) node.properties.href = href;
            if (title) node.properties.title = title;
            if (target) node.properties.target = target;
            if (className) node.properties.className = className;
            if (download) node.properties.download = download;
            if (rel) node.properties.rel = rel;
            if (text) node.children = [{ type: "text", value: text }];
            node.properties = { ...node.properties, ...extra };

            return [SKIP];
        });
    };
}
