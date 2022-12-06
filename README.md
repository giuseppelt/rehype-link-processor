# rehype-link-processor
[rehype](https://github.com/rehypejs/rehype) plugin to process links to
- add custom css classes
- detect external, download, same-page links
- set attributes like `rel` or `target`
- add custom attributes

## Why
This package helps to decorate links usually in a markdown document where no extra attribute can be set.

Common scenarios:
- set external links to open in a new page
- decorate a link with a css class to style it, for example adding an icon next to it
- detect external links even when the url don't start with http(s)://
- detect download links
- identify links under some condition to add custom attributes


When you write links in markdown, you're limited with just the url, text and title. You cannot add custom attributes, for example a css class to style that specific link as you want.

This package helps to process and transform links.

## Installation
This is package is module. So an ESM compatible runtime is required (node 14+, deno, ...)
```bash
npm i rehype-link-processor
# or
pnpm add rehype-link-processor
# or
yarn add rehype-link-processor
```

## Integration
### Within a `unified` pipeline
Include rehype-link-processor in the pipeline:
```ts 
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeLinkProcessor from "rehype-link-processor";

const file = await unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeLinkProcessor)
  .process("...")

```

### Within a `mdx` compilation
Include rehype-link-processor in the rehype plugins:
```ts 
import {compile} from "@mdx-js/mdx";
import rehypeLinkProcessor from "rehype-link-processor";

const file = '[download:Get the pdf](/assets/article.pdf)';

await compile(file, { rehypePlugins: [rehypeLinkProcessor] });
```

### In an Astro website
Include rehype-link-processor as markdown rehype plugin in the `astro.config.ts`:
```ts 
//file: astro.config.ts
import { defineConfig } from "astro/config";
import rehypeLinkProcessor from "rehype-link-processor";

export default defineConfig({
  markdown: {
    rehypePlugins: [rehypeLinkProcessor()]
  }
);
```

## Configuration
The processor works with rules. If a rule matches, the action is applied (the link is transformed), and the processing ends.

So the rule order is important, as the first match wins.

The rules are set via the options argument:
```ts
rehypeLinkProcessor({
  rules: [
    // add rules here
  ]
})
```

This package provides some builtin rules covering common scenarios. You can also add custom rules to fit you needs.

There are three rule types:
- [Builtin](#builtin-rules): identified by a name
- [Match rule](#match-rule): defined by an `object`
- [Transform rule](#transform-rule): defined by a `function`

### Builtin rules
All builtin rules are enabled by default.

Builtin rules can be disabled with `useBuiltin` set to `false`.
```ts
rehypeLinkProcessor({
  useBuiltin: false
})
```
When you disable builtin rules, you can add the ones you like manually.
```ts
rehypeLinkProcessor({
  rules: [
    "external"   // <-- enable the external link rule
  ]
})
```

The builtin rules are:
- `external`
  
  looks for external links matching when one of:
    - the url start with http: or https:
    - the url start with the prefix `external:`
    - the text start with the prefix `external:`
  
  if matched, the resulting `a` will have the attributes:
    - `class` = "external"
    - `target` = "_blank"
    - `rel` = "nofollow noopener"

  <br />
  <details>
  <summary><b>Examples</b></summary>

  Markdown: <br />
  `[Github](https://github.com)`
  
  HTML: <br />
  `<a href="https://github.com" class="external" target="_blank" rel="nofollow noopener">Github<a>`

  ***
  Markdown: <br />
  `[external:Discussion on Github](/discussion)`

  HTML:<br />
  `<a href="/discussion" class="external" target="_blank" rel="nofollow noopener">Discussion on Github</a>`
  </details>
  <br />


- `download`
  
  looks for download links matching when one of:
    - the url ends with `.<ext>` where `ext` is [1-4] chars long
    - the url start with the prefix `download:`
    - the text start with the prefix `download:`
  
  if matched, the resulting `a` will have the attributes:
    - `class` = "download"
    - `download` = the filename extracted or `true` when detected by the prefix

  <br />
  <details>
  <summary><b>Examples</b></summary>

  Markdown: <br />
  `[Download the pdf](/assets/my-article.pdf)`

  HTML: <br />
  `<a download="my-article.pd" href="/assets/my-article.pdf" class="download">Download the pdf<a>`
  ***
  Markdown: <br />
  `[download:Get the Archive](/directory?format=zip)`

  HTML: <br />
  `<a download href="/directory?format=zip" class="download">Get the Archive</a>`

  </details>
  <br />

- `same-page`

  detect navigation within the same page, aka fragment navigation
  - checks if the url starts with `#`
  
  the resulting `a` will have the attributes
  - `class` = "same-page"

  <br />
  <details>
  <summary><b>Examples</b></summary>

  Markdown: <br />
  `[Chapter 2](#chapter-2)`

  HTML: <br />
  `<a href="#chapter-2" class="same-page">Chapter 2<a>`

  </details>
  <br />

### Match rule
A match rule, works in two steps:
- the match: where you identify the link you want to process
- the action: where you specify what transformations you want to apply

```ts
rules: [
  {
    match: link => link.href.startWith("mailto:"),
    action: { className: "email" }
  }
]
```

If the `match` returns a falsy value (`false`, `undefined`, ...). The rule is skipped.

You can specify multiple actions in an Array.

You can use the `A` helper witch provides common actions.
```ts
// rule to correct GiThuB link casing
rules: [
  {
    match: link => link.text?.toLowerCase() === "github"
    action: [
      // add the class: the link can have preexisting class
      A.mergeClass("brand-link"),  
      // another syntax for { text: "GitHub" }
      A.set("text", "GitHub")
    ]
  }
]
```

The match function can also return an object. It will be assigned over the link, overwriting the common fields.

It's useful in a scenario where you want to apply a transformation right away in the matching step.
```ts
rules: [
  {
    match: link => {
      if(link.href.startsWith("http:")){
        return { href: link.href.replace("http:", "https:") };
      }
    },
    action: [
      A.set("target", "_blank"),  
    ]
  }
]
```

### Transform rule
With a transform rule you can analyze any like directly. The transform rule provides a `function` based syntax to process links.

With the link as input, a transform rule can return:
- a falsy value, to skip the rule
- an object, to apply the patch: the object fields overwrite the link ones

You can add a transform rule like any other rule:
```ts
{
  rules: [
    link => {
      if (link.href?.includes("github.com")) {
        return { title: "GitHub: Where this code lives" };
      }
    }
  ]
}
```

## Types
This package is built in typescript so it has full typings support.

## License
[MIT](LICENSE) © [Giuseppe La Torre](https://github.com/giuseppelt)
