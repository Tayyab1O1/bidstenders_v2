export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type DocumentType = 'proposal' | 'cover_letter' | 'technical' | 'custom';

export interface Bid {
  id: string;
  title: string;
  bidNumberList: string;
  bidNameList: string;
  statusList: string;
  postedDate: string;
  closingDateList: string;
  bidClassification: string;
  bidType: string;
  bidNumber: string;
  bidName: string;
  bidStatus: string;
  bidClosingDate: string;
  submissionType: string;
  submissionAddress: string;
  publicOpening: string;
  description: string;
  categories: string;
  reviewStatus: ReviewStatus;
  aiScore: number | null;
  aiScoreReason: string | null;
  aiScoreHighlights: string[] | null;
  aiScoreConcerns: string[] | null;
  aiScoredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScorerSettings {
  companyDescription: string;
  services: string;
  preferredCategories: string;
  avoidKeywords: string;
  minScore: number;
  customInstructions: string;
}

export interface BidDocument {
  id: string;
  title: string;
  content: string;
  type: DocumentType;
  createdAt: string;
  updatedAt: string;
}
