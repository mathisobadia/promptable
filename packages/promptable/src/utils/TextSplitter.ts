import sentencize from "@stdlib/nlp-sentencize";
import GPT3Tokenizer from "gpt3-tokenizer";
import { Document } from "..";

export interface TextSplitterOptions {
  lengthFn?: (text: string) => number;
  chunk?: boolean;
  chunkSize?: number;
  overlap?: number;
  meta?: Record<string, any>;
}

export abstract class TextSplitter {
  chunk = false;
  chunkSize = 1000;
  overlap = 200;

  protected tokenizer = new GPT3Tokenizer({ type: "gpt3" });

  constructor(opts?: TextSplitterOptions) {
    if (typeof opts?.chunkSize !== "undefined") {
      this.chunkSize = opts.chunkSize;
    }
    if (typeof opts?.overlap !== "undefined") {
      if (opts.overlap > this.chunkSize) {
        throw Error(
          `Error: Overlap is greater than chunkSize, overlap ${opts.overlap}, chunksize: ${this.chunkSize}`
        );
      }
      this.overlap = opts.overlap;
    }

    if (typeof opts?.chunk !== "undefined") {
      this.chunk = opts.chunk;
    }

    if (typeof opts?.lengthFn !== "undefined") {
      this.lengthFn = opts.lengthFn;
    }
  }

  abstract splitText(text: string, opts?: TextSplitterOptions): string[];
  mergeText(texts: string[], separator: string = " "): string {
    return texts.map((text) => text.trim()).join(separator);
  }
  mergeDocuments(docs: Document[]): string {
    const texts = docs.map((doc) => doc.data);
    return this.mergeText(texts);
  }
  splitDocuments(docs: Document[], opts?: TextSplitterOptions): Document[] {
    const texts = docs.map((doc) => doc.data);
    const metas = docs.map((doc, i) => ({
      ...doc.meta,
      ...opts?.meta,
      parentId: doc.id,
      part: i,
    }));
    return this.createDocuments(texts, metas, opts);
  }

  // colin: we need to make sure to keep track of the original document id
  createDocuments(
    texts: string[],
    metas: (Record<string, any> | undefined)[] = [],
    opts?: TextSplitterOptions
  ) {
    const docs = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const chunks = this.splitText(text, opts);
      for (const chunk of chunks) {
        docs.push({
          data: chunk,
          meta: metas[i] || {},
        });
      }
    }
    return docs;
  }

  protected createChunks(texts: string[], separator: string): string[] {
    // build up chunks based on chunk size
    return texts.reduce((chunks: string[], text) => {
      let chunk = "";

      // Check if the last chunk is below the chunkSize + overlap.
      const lastChunk = (chunks.length && chunks[chunks.length - 1]) || "";
      const lastChunkLength = this.lengthFn(lastChunk);
      if (lastChunkLength < this.chunkSize + this.overlap) {
        chunk = chunks.pop() || "";
      }

      chunk = chunk === "" ? text : chunk + separator + text;

      if (chunk.length) {
        chunks.push(chunk);
      }

      return chunks;
    }, []);
  }

  getLength: (text: string) => number = (text: string) => {
    return this.lengthFn(text);
  };

  private lengthFn = (text: string) => {
    const encoded: { bpe: number[]; text: string[] } =
      this.tokenizer.encode(text);

    return encoded.bpe.length;
  };
}

export class CharacterTextSplitter extends TextSplitter {
  character: string;

  constructor(character: string = "\\n\\n", opts?: TextSplitterOptions) {
    super(opts);
    this.character = character;
  }

  splitText = (text: string, opts?: TextSplitterOptions): string[] => {
    const texts = text.split(this.character).map((t) => t.trim());
    return opts?.chunk || this.chunk
      ? this.createChunks(texts, this.character)
      : texts.filter((t) => t.length);
  };
}

export class SentenceTextSplitter extends TextSplitter {
  splitText(text: string, opts?: TextSplitterOptions): string[] {
    const sentences = sentencize(text).map((s) => s.trim());
    return opts?.chunk || this.chunk
      ? this.createChunks(sentences, " ")
      : sentences.filter((t) => t.length);
  }
}

export class TokenSplitter extends TextSplitter {
  chunk = true;

  splitText(text: string, opts?: Omit<TextSplitterOptions, "chunk">): string[] {
    const chunkSize = opts?.chunkSize || this.chunkSize;
    const overlap = opts?.overlap || this.overlap;

    const chunks = [];

    // Encode the text using the tokenizer
    const encoded: { bpe: number[]; text: string[] } =
      this.tokenizer.encode(text);

    // Get the length of the input
    const encodedLength = encoded.bpe.length;

    // Set the starting index and current index for the loop
    let startIndex = 0;
    let currentIndex = Math.min(startIndex + chunkSize, encodedLength);

    // Get the encodedChunk by slicing the encoded tokens from startIndex to currentIndex
    let encodedChunk = encoded.bpe.slice(startIndex, currentIndex);

    // While the startIndex is less than the length of the encoded tokens
    while (startIndex < encodedLength) {
      // Decode the encodedChunk and append it to the chunks array
      const chunk = this.tokenizer.decode(encodedChunk);

      // Push the chunk to the chunks array
      chunks.push(chunk);

      // Increment the startIndex by chunkSize - overlap
      startIndex += chunkSize - overlap;

      // Update the currentIndex by taking the minimum of startIndex + chunkSize and length of the encoded tokens
      currentIndex = Math.min(startIndex + chunkSize, encodedLength);

      // Get the encodedChunk by slicing the encoded tokens from startIndex to currentIndex
      encodedChunk = encoded.bpe.slice(startIndex, currentIndex);
    }

    // Return the chunks
    return chunks.map((chunk) => chunk.trim());
  }
}
