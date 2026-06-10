import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { logger } from '@librechat/data-schemas';
import { FileSources } from 'librechat-data-provider';
import type { MistralOCRUploadResult, ServerRequest } from '~/types';
import { logAxiosError } from '~/utils/axios';
import { generateShortLivedToken } from '~/crypto/jwt';

/**
 * Uploads a file to the RAG API for PaddleOCR extraction.
 *
 * @param params - The params object.
 * @param params.req - The request object from Express.
 * @param params.file - The file object to process.
 * @returns - The result object containing the processed `text` and metadata.
 */
export const uploadPaddleOCR = async ({
  req,
  file,
}: {
  req: ServerRequest;
  file: Express.Multer.File;
}): Promise<MistralOCRUploadResult> => {
  const ragApiUrl = process.env.RAG_API_URL;
  if (!ragApiUrl) {
    throw new Error('RAG_API_URL not defined');
  }

  const userId = req.user?.id;
  if (!userId) {
    throw new Error('No user ID provided');
  }

  try {
    const jwtToken = generateShortLivedToken(userId);
    const formData = new FormData();
    formData.append('file', createReadStream(file.path), { filename: file.originalname });
    formData.append('strategy', 'paddleocr');

    const formHeaders = formData.getHeaders();

    const response = await axios.post(`${ragApiUrl}/extract`, formData, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        accept: 'application/json',
        ...formHeaders,
      },
      timeout: 600000, // PaddleOCR can be slow for large docs
    });

    const responseData = response.data;
    logger.debug(`[uploadPaddleOCR] RAG API completed successfully (${response.status})`);

    if (!responseData || typeof responseData.text !== 'string' || !responseData.text.trim()) {
      throw new Error('RAG API did not return valid extracted text');
    }

    return {
      filename: file.originalname,
      bytes: Buffer.byteLength(responseData.text, 'utf8'),
      filepath: FileSources.paddleocr,
      text: responseData.text,
      images: responseData.images ?? [],
    };
  } catch (error) {
    logAxiosError({
      message: '[uploadPaddleOCR] RAG API PaddleOCR extraction failed:',
      error,
    });
    throw error;
  }
};
