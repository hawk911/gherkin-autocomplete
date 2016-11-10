import * as fs from "fs";
import * as path from "path";

let Gherkin = require("gherkin");
let parser = new Gherkin.Parser();
let Glob = require("glob");

let loki = require("lokijs");

import * as vscode from "vscode";

export class Global {
    private cache: any;
    private db: any;
    private dbcalls: any;
    private languages: any;

    private cacheUpdates: boolean;

    constructor(exec: string) {
        this.cache = new loki("gtags.json");
        this.cacheUpdates = false;
    }

    public getCacheLocal(
        filename: string,
        word: string,
        source,
        update: boolean = false,
        allToEnd: boolean = true,
        fromFirst: boolean = true): Array<IMethodValue> {

        let suffix = allToEnd ? "" : "$";
        let prefix = fromFirst ? "^" : "";
        let querystring = { name: { $regex: new RegExp(prefix + word + suffix, "i") } };
        let entries = this.parse(source, filename).find(querystring);
        return entries;
    }

    public updateCache(): any {
        this.cacheUpdates = true;
        this.db = this.cache.addCollection("ValueTable");
        this.dbcalls = this.cache.addCollection("Calls");
        this.languages = this.cache.addCollection("Languages");
        let rootPath = vscode.workspace.rootPath;
        if (rootPath) {
            let files = vscode.workspace.findFiles("**/*.feature", "", 1000);
            files.then((value) => {
                this.addtocachefiles(value);
            }, (reason) => {
                console.log(reason);
            });
        }

        let pathsLibrarys: Array<vscode.Uri> =
                    vscode.workspace.getConfiguration("gherkin-autocomplete")
                                    .get<Array<vscode.Uri>>("featurelibrary", []);
        for (let i = 0; i < pathsLibrarys.length; ++i) {
            let library = pathsLibrarys[i];
            let globSearch = new Glob(library + "**/*.feature", {},
                (err, files) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    for (let i = 0; i < files.length; ++i) {
                        files[i] = vscode.Uri.file(files[i]);
                    }
                    this.addtocachefiles(files);
                });
            globSearch.on("end", () => {
                return;
            });

        }
    };

    public updateCacheOfTextDocument(uri): any {
        this.db.removeWhere((obj) => { return obj.filename = uri.fsPath;});
        this.addFileToCache(uri);
    }

    public query(filename: string, word: string, all: boolean = true, lazy: boolean = false): any {
        if (!this.cacheUpdates) {
            this.updateCache();
            return new Array();
        } else {
            let prefix = lazy ? "" : "^";
            let suffix = all ? "" : "$";
            let querystring = { name: { $regex: new RegExp(prefix + word + suffix, "i") } };
            let search = this.db.chain().find(querystring).simplesort("name").data();
            return search;
        }
    }

    public queryAny(filename: string, word: string): any {
        if (!this.cacheUpdates) {
            this.updateCache();
            return new Array();
        }
        let words = word.split(" ");
        let sb: Array<String> = new Array();
        words.forEach(element => {
            sb.push("(?=.*");
            sb.push(element);
            sb.push(")");
        });
        sb.push(".+");
        let querystring = { name: { $regex: new RegExp(sb.join(""), "i") } };
        let search = this.db.chain().find(querystring).simplesort("name").data();
        return search;
    }

    public getLanguageInfo(filename: string): ILanguageInfo {
        if (!this.cacheUpdates) {
            this.updateCache();
            let languageInfo: ILanguageInfo = {
                language: "en",
                name: filename,
            };
            return languageInfo;
        }

        return this.languages.findOne({ name: filename });
    }

    private fullNameRecursor(word: string, document: vscode.TextDocument, range: vscode.Range, left: boolean) {
        let result: string;
        let plus: number = 1;
        let newRange: vscode.Range;
        if (left) {
            plus = -1;
            if (range.start.character === 0) {
                return word;
            }
            newRange = new vscode.Range(
                new vscode.Position(range.start.line, range.start.character + plus),
                new vscode.Position(range.start.line, range.start.character)
            );
        } else {
            newRange = new vscode.Range(
                new vscode.Position(range.end.line, range.end.character),
                new vscode.Position(range.end.line, range.end.character + plus)
            );
        }
        let dot = document.getText(newRange);
        if (dot.endsWith(".")) {
            let newPosition: vscode.Position;
            if (left) {
                let leftWordRange: vscode.Range = document.getWordRangeAtPosition(newRange.start);
                result = document.getText(leftWordRange) + "." + word;
                if (leftWordRange.start.character > 1) {
                    newPosition = new vscode.Position(leftWordRange.start.line, leftWordRange.start.character - 2);
                } else {
                    newPosition = new vscode.Position(leftWordRange.start.line, 0);
                }
            } else {
                result = word + "." + document.getText(document.getWordRangeAtPosition(newRange.start));
                newPosition = new vscode.Position(newRange.end.line, newRange.end.character + 2);
            }
            let newWord = document.getWordRangeAtPosition(newPosition);
            if (newWord) {
                return this.fullNameRecursor(result, document, newWord, left);
            }
            return result;
        } else {
            result = word;
            return result;
        }
    }

    private addtocachefiles(files: Array<vscode.Uri>): any {
        for (let i = 0; i < files.length; ++i) {
            this.addFileToCache(files[i]);
        }
        vscode.window.setStatusBarMessage("Features' cache is built.", 3000);
    }

    private addFileToCache(uri: vscode.Uri) {
        let fullpath = uri.fsPath;
        let source = fs.readFileSync(fullpath, "utf-8");
        let entries = this.parse(source, fullpath).find();
        let count = 0;
        for (let y = 0; y < entries.length; ++y) {
            let item = entries[y];
            item["filename"] = fullpath;
            let newItem: IMethodValue = {
                description: item.description,
                endline: item.endline,
                filename: fullpath,
                kind: vscode.CompletionItemKind.Module
                line: item.line,
                name: item.description,
            };
            ++count;
            this.db.insert(newItem);
        }
    }

    private parse(source: string, filename: string): any {

        let lockdb = new loki("loki.json");
        let methods = lockdb.addCollection("ValueTable");
        let gherkinDocument;
        try {
            gherkinDocument = parser.parse(source);
        } catch (error) {
            console.log("error parse file " + filename + ":" + error);
            return methods;
        }
        let languageInfo: ILanguageInfo;
        try {
            languageInfo = {
                language: gherkinDocument.feature.language,
                name: filename,
            };
        } catch (error) {
            console.error("error parse language " + filename + ":" + error)
            return methods;
        }

        this.languages.insert(languageInfo);
        if (!gherkinDocument.feature["children"]) {
            return methods;
        }

        const children = gherkinDocument.feature.children;
        for (let index = 0; index < children.length; index++) {
            const child = children[index];
            const steps = child.steps;

            for (let indexStep = 0; indexStep < steps.length; indexStep++) {
                const step = steps[indexStep];
                //let text: string = step.text.replace(/".*?"/gi, "\"\"").replace(/'.*?'/gi, "''");
                let text: string = step.text;
                let methRow: IMethodValue = {
                    description: step.text,
                    endline: step.location.line,
                    filename,
                    line: step.location.line,
                    name: text,
                };

                methods.insert(methRow);
            }

        }

        return methods;
    }
}

export interface IMethodValue {

    name: string;

    // начало
    line: number;
    // конец процедуры
    endline: number;

    filename: string;

    description?: string;

    kind?: vscode.CompletionItemKind;
}

interface ILanguageInfo {
    language: string;
    name: string;
}
