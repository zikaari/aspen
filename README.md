# React Aspen

React Aspen is **the most** performant solution for displaying ~~nested trees~~ *dynamic* nested trees in React apps.

It's uses lightning fast `TypedArray`s to represent the data and `react-window` for super-efficient rendering. You define **what** needs to be rendered
and Aspen figures out the **how**, while leaving you 100% incharge of the **looks**.

<div>
    <img src="https://i.imgur.com/94wkW8q.gif" width="350" alt="Aspen filetree animated demo" style="float: left;margin-right: 10px;margin-bottom: 10px;">
    <div style="display: inline-block;">
        <div>
          <img src="https://i.imgur.com/cTtXhow.gif" width="350" alt="Aspen filetree animated demo" style="display: block">
          <h4>Inline renaming</h4>
      </div>
      <div>
        <img src="https://i.imgur.com/DSTJCeD.gif" width="350" alt="Aspen filetree animated demo">
        <h4>Inline file creation</h4>
      </div>
    </div>
    <div style="clear: both"></div>
</div>

## Trusted by

React aspen is used by some of sweetest companies around the planet:

<a href="https://superb-ai.com" style="position: relative; top: 4px;">
  <img width="250" src="https://assets.website-files.com/5efe868cfe53d9f7c960955e/5efe9db13eab8798f87d3e39_%E1%84%8C%E1%85%A1%E1%84%89%E1%85%A1%E1%86%AB%202%404x%201.png">
</a>
<div style="display: inline-block; border-left: 1px solid; margin-left: 18px; padding-left: 18px;">
  Using <code>react-aspen</code>?<br />
	Add your company by <a href="https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/creating-a-pull-request">
	creating a pull request</a>
</div>

## Features

 - Zero recursion. Unlike most implementations, which recurse the given nested object to flatten it out at once, Aspen sets up an initial `Uint32Array` for
 initially visible items and then uses *diff/patch* technique thereafter for when subsequent nodes are expanded or collapsed. During benchmarks (expanding/collapsing
 nodes), Aspen was `150x` faster than `react-virtualized-tree` which uses recursive flattening and `4x` faster than VSCode's TreeView which uses
 "linked-lists" as the data container (see below for flamegraph)
 - Best of the best; Aspen uses `Uint32Arrays` internally to represent the flattened structure, this is awesome since `TypedArrays` are way faster than regular `Arrays` in all
 the operations, especially splicing and lookups. While benchmarking, `TypedArray`s were found to be `5x`
 times faster than regular `Array`s when tested in Safari.
 - Aspen comes with all the necessary API that you can imagine *(and beyond!)*. Don't wanna have a mess of expanded nodes when you just wanna peek an item?
 `#peekABoo` will do just that. `#openDirectory`, `#closeDirectory`, `#ensureVisible`, you name it!
 - Ability to rename (and create new) items **inline**, previsously this was not so trivial especially when working with virtualized lists. Just call `#promptRename`
 or `#promptNewFile` and setup your renderer to render the passed `<ProxiedInput/>` component as you like.
 - `Drag`, `Drop`, `Add`, `Move`, `Remove` anything and anywhere, Aspen will seamlessly apply that update while preserving tree expansion state, once again, without recursion.
 Updates like these get applied like "patches" thus nothing gets lost.
 - Since Apen uses virtualized list, *nested* structures aren't rendered as *nested* DOM nodes, but instead as individual items, thus CSS inheritence doesn't work.
 Therefore, to fix that Aspen comes with a sick decorations (styling) system*, where you can specify the styles for one parent and Aspen will work out the inheritance
 automatically for all of its children (of course you can negate any children if you so desire, just like CSS's `:not` selector).

These were just some of the awesome features Aspen has to offer. Aspen is a very low-level library with a lot of very low-level API's. With that said, your imagination is
now the limit!

> \* Decorations system is not part of the core lib, instead its shipped separately as [`aspen-decorations`](https://github.com/neeksandhu/aspen-decorations) package,
see its `README` for how to wire it up with `react-aspen`

## Performance

`vscode` and `react-aspen` were put head-to-head and stress tested by repeatedly expanding and collapsing `node_modules` directory which contained `562` directories. That is
`562` items coming in and out of view on each expand and collapse respectively.

Each click event lead to toggling of directory state and an immediate render.

*Tested on Intel i7 4700HQ 2.4GHZ 4 Cores / Nvidia GTX 860M (under normal workload and no throttling was enabled)*

<div style="text-align: center"><img style="margin: 8px" src="https://i.imgur.com/MUL9UVe.jpg" width="500"/><img style="margin: 8px" src="https://i.imgur.com/yjL3Vy1.jpg" width="500"/></div>

## Usage

```bash
npm i react-aspen
```

Since `react-aspen` is a low-level package, it does require little bit of love on your side. But once setup properly, you'll be set for eternity.

It is highly recommended that you fork off of [`react-aspen-demo`](https://github.com/neeksandhu/react-aspen-demo) which has almost all of the features implemented and
ready-to-go. Features like keyboard shortcuts, dragging-dropping and other bunch of cool stuff. Once you fork, please give back by creating a pull request should you
make a change. That helps all of us.

As an alternative to forking, you can consider making it a git submodule in your project.

Here's a very stripped down version of what it takes to get Aspen going:

```tsx
// MyCustomisedFileTree.tsx
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { TreeModel, FileTree, IBasicFileSystemHost, IFileEntryItem, IItemRenderer, IItemRendererProps, ItemType } from 'react-aspen'

// ...

const host: IBasicFileSystemHost = {
	pathStyle: 'unix', // or 'win32'
	getItems: (path: string): IFileEntryItem[] => {
		// ...
	}
}

const treeModel: TreeModel = new TreeModel(host, '/absolute/path/that/will/act/as/root')

class FileEntryItem extends React.Component {
	// ...
}

ReactDOM.render(
	<FileTree
		height={500}
		width={300}
		itemHeight={FileEntryItem.renderedHeight}
		model={treeModel}>
		{({item, itemType}) => <FileEntryItem item={item} itemType={itemType} />}
	</FileTree>,
	document.getElementById('app'))
```

> Above example only describes the moving parts it takes to get Aspen operational, `react-aspen-demo` has everything you need to use it in a production app.

### Decorations

Aspen comes with a decoration system to ease styling/tagging things for you. You can define a set of classnames (or "tags") to be applied to an item, optionally
all of its children (you can use negations, like CSS's `:not` selector). Decoration engine will keep all the inheritances and negations up to date even when a
node changes its parent.

See [`aspen-decorations`](https://github.com/neeksandhu/aspen-decorations) for an example on how to wire it up with `react-aspen`.

## API

This project is written using `TypeScript` and all the API is documented using `TypeDoc` which can be found [here](https://neeksandhu.github.io/react-aspen).

## Ports on other frameworks

At this point I do not plan to work on porting aspen to other framworks (`vue`, `angular` or vanilla). But good news is, 95% of what makes `react-aspen` come to life
is available as separate standalone package called [`aspen-tree-model`](https://github.com/neeksandhu/aspen-tree-model). Most of the features listed above are
actually part of `aspen-tree-model` package (except logic for inline prompts, since it's a UI thing). I believe it should be fairly easy to make that work. If you do
bring aspen to another framework, please open a issue/PR so we can add that to this readme.

## License

Licensed under MIT license. If you use this package in your app or product please consider crediting as you see fit. Not required, but would be nice 🙂
